import React, { useEffect, useMemo, useState } from 'react'
import { Connector, useAccount, useBalance, useConnect, useProvider } from '@starknet-react/core'
import { AccountInterface, constants } from 'starknet'
import { ChainId, Currency, CurrencyAmount, Token } from '@vnaysn/jediswap-sdk-core'
import { WETH } from '@jediswap/sdk'
import { useDefaultActiveTokens } from './Tokens'
import formatBalance from 'utils/formatBalance'
import { useQuery } from 'react-query'
import { ethers } from 'ethers'
// Define the type for the balances object
declare enum StarknetChainId {
  SN_MAIN = '0x534e5f4d41494e',
  SN_GOERLI = '0x534e5f5345504f4c4941',
}

// Function to convert StarknetChainId to ChainId
const convertStarknetToChainId = (starknetId: StarknetChainId): ChainId | undefined => {
  switch (starknetId) {
    case StarknetChainId.SN_MAIN:
      return ChainId.MAINNET
    case StarknetChainId.SN_GOERLI:
      return ChainId.GOERLI
    default:
      return undefined // Return undefined if no match found
  }
}

export const useAccountDetails = (): {
  account: AccountInterface | undefined
  address: string | undefined
  isConnected: boolean | undefined
  chainId: ChainId | undefined
  connector: Connector | undefined
} => {
  const { account, address, isConnected, status, connector } = useAccount()

  const { provider } = useProvider()

  const connectedChainId = useQuery({
    queryKey: [`get_chainId/${address}`],
    queryFn: async () => {
      if (!address) return
      const results: any = await provider.getChainId()
      const convertedId: ChainId | undefined = convertStarknetToChainId(results)
      return results
    },
  })

  const chainId = useMemo(() => {
    if (!connectedChainId || !connectedChainId.data) return ChainId.MAINNET
    return connectedChainId.data
  }, [connectedChainId, address])

  return { account, address, isConnected, chainId, connector }
}

export const useConnectors = () => {
  const { connect, connectors } = useConnect()
  return { connect, connectors }
}

export const useAccountBalance = (currency: Currency | undefined) => {
  if (!currency) undefined

  const { address } = useAccountDetails()
  const tokenAddress = (currency as any)?.address

  const { data } = useBalance({
    token: tokenAddress,
    address,
    watch: true,
  })
  const balance = data ? ethers.utils.formatUnits(data.value, data.decimals) : null //data?.formatted is not accurately implemented, so we a convert balance to String by ourselves
  const balanceCurrencyAmount =
    data && currency ? CurrencyAmount.fromRawAmount(currency, data.value.toString()) : undefined
  return { balance, formatted: formatBalance(balance), balanceCurrencyAmount }
}
