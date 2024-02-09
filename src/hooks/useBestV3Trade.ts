import { Token, Currency, CurrencyAmount, TokenAmount, TradeType } from '@vnaysn/jediswap-sdk-core'
import { encodeRouteToPath, Pool, Route, Trade } from '@vnaysn/jediswap-sdk-v3'
import { BigNumber } from 'ethers'
import { useEffect, useMemo, useState } from 'react'
import { useSingleContractMultipleData } from '../state/multicall/hooks'
import { useAllV3Routes } from './useAllV3Routes'
import { useBlockNumber, useContractRead } from '@starknet-react/core'
import SWAP_QUOTER_ABI from 'contracts/swapquoter/abi.json'
import { DEFAULT_CHAIN_ID, SWAP_ROUTER_ADDRESS } from 'constants/tokens'
import {
  BigNumberish,
  BlockNumber,
  CallData,
  Invocation,
  InvocationsDetails,
  RpcProvider,
  TransactionType,
  cairo,
  encode,
  num,
} from 'starknet'
import { TradeState } from 'state/routing/types'
import { ec, hash, json, Contract, WeierstrassSignatureType } from 'starknet'
import { useAccountDetails } from './starknet-react'
import { useApprovalCall } from './useApproveCall'
import { useUserSlippageToleranceWithDefault } from 'state/user/hooks'
import useTransactionDeadline from './useTransactionDeadline'
import { useQuery } from 'react-query'
// import { useV3Quoter } from './useContract'
import ERC20_ABI from 'abis/erc20.json'

const provider = new RpcProvider({
  nodeUrl: 'https://starknet-testnet.public.blastapi.io/rpc/v0_6',
})

export enum V3TradeState {
  LOADING,
  INVALID,
  NO_ROUTE_FOUND,
  VALID,
  SYNCING,
}

// const useResults = (promise: any) => {
//   const [data, setData] = useState()
//   const results = useMemo(() => {
//     if (!promise) return
//     promise.then((res: any) => setData(res))
//   }, [promise])

//   // return data
// }

/**
 * Returns the best v3 trade for a desired exact input swap
 * @param amountIn the amount to swap in
 * @param currencyOut the desired output currency
 */
export function useBestV3TradeExactIn(
  allPools: string[],
  amountIn?: any,
  currencyOut?: Currency
): { state: TradeState; trade: any | null } {
  const deadline = useTransactionDeadline()
  const { routes, loading: routesLoading } = useAllV3Routes(allPools, amountIn?.currency, currencyOut)
  // State to store the resolved result

  if (!routes)
    return {
      state: TradeState.NO_ROUTE_FOUND,
      trade: null,
    }

  const { account, address, chainId, connector } = useAccountDetails()
  const swapRouterAddress = SWAP_ROUTER_ADDRESS[chainId ?? DEFAULT_CHAIN_ID]

  const quoteExactInInputs = useMemo(() => {
    if (routesLoading || !amountIn || !address || !routes || !routes.length || !deadline) return
    return routes.map((route: Route<Currency, Currency>) => {
      const isRouteSingleHop = route.pools.length === 1

      //multi hop
      if (!isRouteSingleHop) {
        const firstInputToken: Token = route.input.wrapped
        //create path
        const { path } = route.pools.reduce(
          (
            { inputToken, path, types }: { inputToken: Token; path: (string | number)[]; types: string[] },
            pool: Pool,
            index
          ): { inputToken: Token; path: (string | number)[]; types: string[] } => {
            const outputToken: Token = pool.token0.equals(inputToken) ? pool.token1 : pool.token0
            if (index === 0) {
              return {
                inputToken: outputToken,
                types: ['address', 'address', 'uint24'],
                path: [inputToken.address, outputToken.address, pool.fee],
              }
            } else {
              return {
                inputToken: outputToken,
                types: [...types, 'address', 'address', 'uint24'],
                path: [...path, inputToken.address, outputToken.address, pool.fee],
              }
            }
          },
          { inputToken: firstInputToken, path: [], types: [] }
        )

        const exactInputSingleParams = {
          path,
          recipient: address,
          deadline: cairo.felt(deadline.toString()),
          amount_in: amountIn ? cairo.uint256(`0x${amountIn.raw.toString(16)}`) : 0,
          amount_out_minimum: cairo.uint256(0),
        }

        const call = {
          contractAddress: swapRouterAddress,
          entrypoint: 'exact_input',
          calldata: CallData.compile(exactInputSingleParams),
        }

        return call
      } else {
        //single hop
        const isCurrencyInFirst = amountIn?.currency?.address === route.pools[0].token0.address
        const sortedTokens = isCurrencyInFirst
          ? [route.pools[0].token0.address, route.pools[0].token1.address]
          : [route.pools[0].token1.address, route.pools[0].token0.address]
        const exactInputSingleParams = {
          token_in: sortedTokens[0],
          token_out: sortedTokens[1],
          fee: route.pools[0].fee,
          recipient: address,
          deadline: cairo.felt(deadline.toString()),
          amount_in: amountIn ? cairo.uint256(`0x${amountIn.raw.toString(16)}`) : 0,
          amount_out_minimum: cairo.uint256(0),
          sqrt_price_limit_X96: cairo.uint256(0),
        }

        const call = {
          // contractAddress: swapRouterAddress,
          // entrypoint: 'exact_input_single',
          calldata: exactInputSingleParams,
        }

        return call
      }
    })
  }, [routes, amountIn, address])

  const approveSelector = useMemo(() => {
    if (!amountIn || !address) return
    const approveParams = {
      currency_address: amountIn.currency.address,
      selector: hash.getSelectorFromName('approve'),
      approve_call_data_length: '0x03',
      router_address: swapRouterAddress,
      approveAmount: cairo.uint256(2 ** 128),
    }

    return {
      currency_address: amountIn?.currency?.address,
      selector: hash.getSelectorFromName('approve'),
    }
  }, [amountIn, address])

  const totalTx = {
    totalTx: '0x2',
  }

  //approval
  // const approveSelector = {
  //   currency_address: amountIn?.currency?.address,
  //   selector: hash.getSelectorFromName('approve'),
  // }
  const approve_call_data_length = { approve_call_data_length: '0x03' }
  const approve_call_data = {
    router_address: swapRouterAddress,
    approveAmount: cairo.uint256(2 ** 128),
  }

  //exact input
  const inputSelector = {
    contract_address: swapRouterAddress,
    entry_point: hash.getSelectorFromName('exact_input_single'),
  }
  const input_call_data_length = { input_call_data_length: '0xb' }

  const nonce_results = useQuery({
    queryKey: [`nonce/${address}`],
    queryFn: async () => {
      if (!account) return
      const results = await account?.getNonce()
      return cairo.felt(results.toString())
    },
    onSuccess: (data) => {
      // Handle the successful data fetching here if needed
    },
  })

  const privateKey = '0x1234567890987654321'

  const message: BigNumberish[] = [1, 128, 18, 14]

  const msgHash = hash.computeHashOnElements(message)
  const signature: WeierstrassSignatureType = ec.starkCurve.sign(msgHash, privateKey)

  // const fetchResults = useFetchResults(account, blockNumber, callsArr)
  const amountOutResults = useQuery({
    queryKey: ['get_simulation', address, amountIn],
    queryFn: async () => {
      if (!address || !account || !approveSelector || !quoteExactInInputs || !connector || !nonce_results) return
      const nonce = Number(nonce_results.data)
      const callPromises = quoteExactInInputs.map(async (call: any) => {
        const isConnectorBraavos = connector.id === 'braavos'

        const payload = isConnectorBraavos
          ? {
              contractAddress: address,
              calldata: CallData.compile({
                ...totalTx,
                ...approveSelector,
                ...{ approve_offset: '0x0' },
                ...approve_call_data_length,
                ...inputSelector,
                ...{ input_offset: approve_call_data_length },
                ...input_call_data_length,
                ...{ total_call_data_length: '0xe' },
                ...approve_call_data,
                ...call.calldata,
              }),
            }
          : {
              contractAddress: address,
              calldata: CallData.compile({
                ...totalTx,
                ...approveSelector,
                ...approve_call_data_length,
                ...approve_call_data,
                ...inputSelector,
                ...input_call_data_length,
                ...call.calldata,
              }),
            }
        // const compiledCall = CallData.
        const response = provider.simulateTransaction(
          [{ type: TransactionType.INVOKE, ...payload, signature, nonce }],
          {
            skipValidate: true,
          }
        )

        return response
      })

      const settledResults = await Promise.allSettled(callPromises as any)

      const resolvedResults = settledResults
        .filter((result) => result.status === 'fulfilled')
        .map((result: any) => result.value)

      return resolvedResults
    },
    onSuccess: (data) => {
      // Handle the successful data fetching here if needed
    },
  })

  function fromUint256ToNumber(uint256: any) {
    // Assuming uint256 is an object with 'high' and 'low' properties
    const { high } = uint256
    return high
  }

  const filteredAmountOutResults = useMemo(() => {
    if (!amountOutResults) return
    const data = amountOutResults?.data

    if (!data) return
    const subRoutesArray = data.map((subArray) => subArray[0])
    const bestRouteResults = { bestRoute: null, amountOut: null }
    const { bestRoute, amountOut } = subRoutesArray
      .filter((result: any) => result?.transaction_trace?.execute_invocation?.result)
      .reduce((currentBest: any, result: any, i: any) => {
        const selected_tx_result = result?.transaction_trace?.execute_invocation?.result
        const value = selected_tx_result[selected_tx_result.length - 2]
        const amountOut = fromUint256ToNumber({ high: value })
        if (!result) return currentBest
        if (currentBest.amountOut === null) {
          return {
            bestRoute: routes[i],
            amountOut,
          }
        } else if (Number(cairo.felt(currentBest.amountOut)) < Number(cairo.felt(amountOut))) {
          return {
            bestRoute: routes[i],
            amountOut,
          }
        }

        return currentBest
      }, bestRouteResults)

    return { bestRoute, amountOut }
  }, [amountOutResults])

  const { bestRoute, amountOut } = useMemo(() => {
    if (!filteredAmountOutResults) return { bestRoute: null, amountOut: null }
    return { bestRoute: filteredAmountOutResults.bestRoute, amountOut: filteredAmountOutResults.amountOut }
  }, [filteredAmountOutResults])

  return useMemo(() => {
    if (!routes.length) {
      return {
        state: TradeState.NO_ROUTE_FOUND,
        trade: null,
      }
    }

    if (!amountIn || !currencyOut || !filteredAmountOutResults) {
      return {
        state: TradeState.INVALID,
        trade: null,
      }
    }

    if (routesLoading) {
      return {
        state: TradeState.LOADING,
        trade: null,
      }
    }

    if (!bestRoute || !amountOut) {
      return {
        state: TradeState.NO_ROUTE_FOUND,
        trade: null,
      }
    }

    // const isSyncing = quotesResults.some(({ syncing }) => syncing)

    return {
      state: TradeState.VALID,
      trade: Trade.createUncheckedTrade({
        route: bestRoute,
        tradeType: TradeType.EXACT_INPUT,
        inputAmount: amountIn,
        outputAmount: CurrencyAmount.fromRawAmount(currencyOut, num.hexToDecimalString(amountOut)),
      }),
    }
  }, [amountIn, currencyOut, filteredAmountOutResults, routes, routesLoading])
}

/**
 * Returns the best v3 trade for a desired exact output swap
 * @param currencyIn the desired input currency
 * @param amountOut the amount to swap out
 */
export function useBestV3TradeExactOut(
  allPools: string[],
  currencyIn?: Currency,
  amountOut?: any
): { state: TradeState; trade: any | null } {
  // : { state: V3TradeState; trade: any | null }
  // const quoter = useV3Quoter()
  const deadline = useTransactionDeadline()
  const { routes, loading: routesLoading } = useAllV3Routes(allPools, currencyIn, amountOut?.currency)
  const { address, account, chainId } = useAccountDetails()
  const swapRouterAddress = SWAP_ROUTER_ADDRESS[chainId ?? DEFAULT_CHAIN_ID]

  const quoteExactOutInputs = useMemo(() => {
    if (routesLoading || !amountOut || !address || !routes || !routes.length || !deadline) return
    return routes.map((route: Route<Currency, Currency>) => {
      const isRouteSingleHop = route.pools.length === 1

      //multi hop
      if (!isRouteSingleHop) {
        const firstInputToken: Token = route.input.wrapped
        //create path
        const { path } = route.pools.reduce(
          (
            { inputToken, path, types }: { inputToken: Token; path: (string | number)[]; types: string[] },
            pool: Pool,
            index
          ): { inputToken: Token; path: (string | number)[]; types: string[] } => {
            const outputToken: Token = pool.token0.equals(inputToken) ? pool.token1 : pool.token0
            if (index === 0) {
              return {
                inputToken: outputToken,
                types: ['address', 'address', 'uint24'],
                path: [inputToken.address, outputToken.address, pool.fee],
              }
            } else {
              return {
                inputToken: outputToken,
                types: [...types, 'address', 'address', 'uint24'],
                path: [...path, inputToken.address, outputToken.address, pool.fee],
              }
            }
          },
          { inputToken: firstInputToken, path: [], types: [] }
        )

        const reversePath = path.reverse()

        const exactOutputSingleParams = {
          path: reversePath,
          recipient: address,
          deadline: cairo.felt(deadline.toString()),
          amount_out: amountOut ? cairo.uint256(`0x${amountOut.raw.toString(16)}`) : 0,
          amount_in_maximum: cairo.uint256(2 ** 128),
        }

        const call = {
          contractAddress: swapRouterAddress,
          entrypoint: 'exact_output',
          calldata: CallData.compile(exactOutputSingleParams),
        }

        return call
      } else {
        //single hop
        const isCurrencyInFirst = amountOut?.currency?.address === route.pools[0].token0.address
        const sortedTokens = isCurrencyInFirst
          ? [route.pools[0].token0.address, route.pools[0].token1.address]
          : [route.pools[0].token1.address, route.pools[0].token0.address]
        const exactOutputSingleParams = {
          token_in: sortedTokens[1],
          token_out: sortedTokens[0],
          fee: route.pools[0].fee,
          recipient: address,
          deadline: cairo.felt(deadline.toString()),
          amount_out: amountOut ? cairo.uint256(`0x${amountOut.raw.toString(16)}`) : 0,
          amount_in_maximum: cairo.uint256(2 ** 128),
          sqrt_price_limit_X96: cairo.uint256(0),
        }

        const call = {
          contractAddress: swapRouterAddress,
          entrypoint: 'exact_output_single',
          calldata: CallData.compile(exactOutputSingleParams),
        }

        return call
      }
    })
  }, [routes && routes.length, amountOut])

  const approveCall = useMemo(() => {
    if (!amountOut || !currencyIn) return
    const approveParams = {
      spender: swapRouterAddress,
      approveAmount: cairo.uint256(2 ** 128),
    }

    return {
      contractAddress: (currencyIn as any).address,
      entrypoint: 'approve',
      calldata: CallData.compile(approveParams),
    }
  }, [amountOut, currencyIn])

  // const { data, error } = useQuoteExactInput(compiledCallData)

  const message: BigNumberish[] = [1, 128, 18, 14]

  const callsArr = useMemo(() => {
    if (!quoteExactOutInputs || !quoteExactOutInputs.length) return

    const results = quoteExactOutInputs.map((input, index) => {
      return [approveCall, input]
    })

    return results
  }, [quoteExactOutInputs, approveCall])

  const amountInResults = useQuery({
    queryKey: [address, amountOut],
    queryFn: async () => {
      if (!address || !account || !callsArr || !callsArr.length) return

      const callPromises = callsArr.map(async (call: any) => {
        const response = await account.simulateTransaction([{ type: TransactionType.INVOKE, payload: call }], {
          skipValidate: true,
        })

        return response
      })

      const settledResults = await Promise.allSettled(callPromises as any)

      const resolvedResults = settledResults
        .filter((result) => result.status === 'fulfilled')
        .map((result: any) => result.value)

      return resolvedResults
    },
    onSuccess: (data) => {
      // Handle the successful data fetching here if needed
    },
  })

  function fromUint256ToNumber(uint256: any) {
    // Assuming uint256 is an object with 'high' and 'low' properties
    const { high } = uint256
    return high
  }

  const filteredAmountInResults = useMemo(() => {
    if (!amountInResults) return
    const data = amountInResults?.data

    if (!data) return
    const subRoutesArray = data.map((subArray) => subArray[0])
    const bestRouteResults = { bestRoute: null, amountIn: null }
    const { bestRoute, amountIn } = subRoutesArray.reduce((currentBest: any, result: any, i: any) => {
      const selected_tx_result = result?.transaction_trace?.execute_invocation?.result
      const value = selected_tx_result[selected_tx_result.length - 2]
      const amountIn = fromUint256ToNumber({ high: value })
      if (!result) return currentBest
      if (currentBest.amountIn === null) {
        return {
          bestRoute: routes[i],
          amountIn,
        }
      } else if (Number(cairo.felt(currentBest.amountIn)) < Number(cairo.felt(amountIn))) {
        return {
          bestRoute: routes[i],
          amountIn,
        }
      }

      return currentBest
    }, bestRouteResults)

    return { bestRoute, amountIn }
  }, [amountInResults])

  const { bestRoute, amountIn } = useMemo(() => {
    if (!filteredAmountInResults) return { bestRoute: null, amountIn: null }
    return { bestRoute: filteredAmountInResults.bestRoute, amountIn: filteredAmountInResults.amountIn }
  }, [filteredAmountInResults])

  return useMemo(() => {
    if (!routes.length) {
      return {
        state: TradeState.NO_ROUTE_FOUND,
        trade: null,
      }
    }

    if (!amountOut || !currencyIn || !filteredAmountInResults) {
      return {
        state: TradeState.INVALID,
        trade: null,
      }
    }

    if (routesLoading) {
      return {
        state: TradeState.LOADING,
        trade: null,
      }
    }

    if (!bestRoute || !amountIn) {
      return {
        state: TradeState.NO_ROUTE_FOUND,
        trade: null,
      }
    }

    return {
      state: TradeState.VALID,
      trade: Trade.createUncheckedTrade({
        route: bestRoute,
        tradeType: TradeType.EXACT_OUTPUT,
        inputAmount: CurrencyAmount.fromRawAmount(currencyIn, num.hexToDecimalString(amountIn)),
        outputAmount: amountOut,
      }),
    }
  }, [amountOut, currencyIn, routesLoading, routes, filteredAmountInResults])
}
