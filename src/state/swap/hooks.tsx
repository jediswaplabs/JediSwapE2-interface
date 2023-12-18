import { Trans } from '@lingui/macro'
import { ChainId, Currency, CurrencyAmount, Percent, TradeType } from '@vnaysn/jediswap-sdk-core'
import { ParsedQs } from 'qs'
import { ReactNode, useCallback, useEffect, useMemo } from 'react'
import { AnyAction } from 'redux'
import { Trade } from '@jediswap/sdk'

import { useAccountDetails } from 'hooks/starknet-react'
import tryParseCurrencyAmount from 'lib/utils/tryParseCurrencyAmount'
import { useAppDispatch } from 'state/hooks'
import { useUserSlippageTolerance, useUserSlippageToleranceWithDefault } from 'state/user/hooks'

// import { TOKEN_SHORTHANDS } from '../../constants/tokens'
import { useCurrency } from '../../hooks/Tokens'
import useENS from '../../hooks/useENS'
import useParsedQueryString from '../../hooks/useParsedQueryString'
import { isAddress } from '../../utils'
import { useCurrencyBalances } from '../connection/hooks'
import { Field, replaceSwapState, selectCurrency, setRecipient, switchCurrencies, typeInput } from './actions'
import { SwapState } from './reducer'
import { computeSlippageAdjustedAmounts } from 'utils/prices'
import { useAddressNormalizer } from '../../hooks/useAddressNormalizer'
import { useTradeExactIn, useTradeExactOut } from '../../hooks/Trades'
import { isAddressValidForStarknet } from '../../utils/addresses'

export function useSwapActionHandlers(dispatch: React.Dispatch<AnyAction>): {
  onCurrencySelection: (field: Field, currency: Currency) => void
  onSwitchTokens: (newOutputHasTax: boolean, previouslyEstimatedOutput: string) => void
  onUserInput: (field: Field, typedValue: string) => void
  onChangeRecipient: (recipient: string | null) => void
} {
  const onCurrencySelection = useCallback(
    (field: Field, currency: Currency) => {
      dispatch(
        selectCurrency({
          field,
          currencyId: currency.isToken ? currency.address : currency.isNative ? 'ETH' : '',
        })
      )
    },
    [dispatch]
  )

  const onSwitchTokens = useCallback(
    (newOutputHasTax: boolean, previouslyEstimatedOutput: string) => {
      dispatch(switchCurrencies({ newOutputHasTax, previouslyEstimatedOutput }))
    },
    [dispatch]
  )

  const onUserInput = useCallback(
    (field: Field, typedValue: string) => {
      dispatch(typeInput({ field, typedValue }))
    },
    [dispatch]
  )

  const onChangeRecipient = useCallback(
    (recipient: string | null) => {
      dispatch(setRecipient({ recipient }))
    },
    [dispatch]
  )

  return {
    onSwitchTokens,
    onCurrencySelection,
    onUserInput,
    onChangeRecipient,
  }
}

const BAD_RECIPIENT_ADDRESSES: { [address: string]: true } = {
  '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f': true, // v2 factory
  '0xf164fC0Ec4E93095b804a4795bBe1e041497b92a': true, // v2 router 01
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D': true, // v2 router 02
}

export type SwapInfo = {
  currencies: { [field in Field]?: Currency }
  currencyBalances: { [field in Field]?: CurrencyAmount<Currency> }
  parsedAmount?: CurrencyAmount<Currency>
  inputError?: ReactNode
  trade: Trade
  tradeLoading: boolean
}

// from the current swap inputs, compute the best trade and return it.
export function useDerivedSwapInfo(state: SwapState, chainId: ChainId | undefined): SwapInfo {
  const { address: connectedAddress } = useAccountDetails()
  const {
    independentField,
    typedValue,
    [Field.INPUT]: { currencyId: inputCurrencyId },
    [Field.OUTPUT]: { currencyId: outputCurrencyId },
    recipient,
  } = state
  const inputCurrency = useCurrency(inputCurrencyId, chainId)
  const outputCurrency = useCurrency(outputCurrencyId, chainId)
  const address = useAddressNormalizer(recipient ?? undefined)
  const to: string | null = (recipient === null ? connectedAddress : address) ?? null

  const relevantTokenBalances = useCurrencyBalances(connectedAddress ?? undefined, [inputCurrency, outputCurrency])

  const isExactIn: boolean = independentField === Field.INPUT
  const parsedAmount = useMemo(
    () => tryParseCurrencyAmount(typedValue, (isExactIn ? inputCurrency : outputCurrency) ?? undefined),
    [inputCurrency, isExactIn, outputCurrency, typedValue]
  )

  const [bestTradeExactIn, bestTradeInLoading] = useTradeExactIn(
    isExactIn ? parsedAmount : undefined,
    outputCurrency ?? undefined
  )

  const [bestTradeExactOut, bestTradeOutLoading] = useTradeExactOut(
    inputCurrency ?? undefined,
    !isExactIn ? parsedAmount : undefined
  )

  const trade = isExactIn ? bestTradeExactIn : bestTradeExactOut

  const currencyBalances: { [field in Field]?: Currency } = useMemo(
    () => ({
      [Field.INPUT]: relevantTokenBalances[0],
      [Field.OUTPUT]: relevantTokenBalances[1],
    }),
    [relevantTokenBalances]
  )

  const currencies: { [field in Field]?: Currency } = useMemo(
    () => ({
      [Field.INPUT]: inputCurrency,
      [Field.OUTPUT]: outputCurrency,
    }),
    [inputCurrency, outputCurrency]
  )

  const [allowedSlippage] = useUserSlippageTolerance()
  const slippageAdjustedAmounts =
    trade && allowedSlippage && computeSlippageAdjustedAmounts(trade.trade as any, allowedSlippage)

  const inputError = useMemo(() => {
    let inputError: ReactNode | undefined

    if (!connectedAddress) {
      inputError = <Trans>Connect wallet</Trans>
    }

    if (!currencyBalances[Field.INPUT] || !currencyBalances[Field.OUTPUT]) {
      inputError = inputError ?? <Trans>Select a token</Trans>
    }

    if (!parsedAmount) {
      inputError = inputError ?? <Trans>Enter an amount</Trans>
    }

    const formattedTo = isAddressValidForStarknet(to)
    if (!to || !formattedTo) {
      inputError = inputError ?? <Trans>Enter a recipient</Trans>
    } else if (
      BAD_RECIPIENT_ADDRESSES[formattedTo] ||
      (bestTradeExactIn && involvesAddress(bestTradeExactIn, formattedTo)) ||
      (bestTradeExactOut && involvesAddress(bestTradeExactOut, formattedTo))
    ) {
      inputError = inputError ?? <Trans>Invalid recipient</Trans>
    }

    // compare input balance to max input based on version
    const [balanceIn, maxAmountIn] = [
      currencyBalances[Field.INPUT],
      slippageAdjustedAmounts ? slippageAdjustedAmounts[Field.INPUT] : null,
    ]

    // compare input balance to max input based on version
    // const [balanceIn, maxAmountIn] = [currencyBalances[Field.INPUT], trade?.trade?.maximumAmountIn(allowedSlippage)]

    if (balanceIn && maxAmountIn && balanceIn.lessThan(maxAmountIn)) {
      inputError = <Trans>Insufficient {balanceIn.currency.symbol} balance</Trans>
    }

    return inputError
  }, [connectedAddress, currencies, parsedAmount, to, currencyBalances, trade?.trade, allowedSlippage])

  return {
    currencies,
    currencyBalances,
    parsedAmount,
    inputError,
    trade,
    tradeLoading: isExactIn ? bestTradeInLoading : bestTradeOutLoading,
  }
}

function parseCurrencyFromURLParameter(urlParam: ParsedQs[string]): string {
  if (typeof urlParam === 'string') {
    const valid = isAddress(urlParam)
    if (valid) {
      return valid
    }
    const upper = urlParam.toUpperCase()
    if (upper === 'ETH') {
      return 'ETH'
    }
    // if (upper in TOKEN_SHORTHANDS) return upper
  }
  return ''
}

function parseTokenAmountURLParameter(urlParam: any): string {
  return typeof urlParam === 'string' && !isNaN(parseFloat(urlParam)) ? urlParam : ''
}

function parseIndependentFieldURLParameter(urlParam: any): Field {
  return typeof urlParam === 'string' && urlParam.toLowerCase() === 'output' ? Field.OUTPUT : Field.INPUT
}

const ENS_NAME_REGEX = /^[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
function validatedRecipient(recipient: any): string | null {
  if (typeof recipient !== 'string') {
    return null
  }
  const address = isAddress(recipient)
  if (address) {
    return address
  }
  if (ENS_NAME_REGEX.test(recipient)) {
    return recipient
  }
  if (ADDRESS_REGEX.test(recipient)) {
    return recipient
  }
  return null
}

export function queryParametersToSwapState(parsedQs: ParsedQs): SwapState {
  let inputCurrency = parseCurrencyFromURLParameter(parsedQs.inputCurrency)
  let outputCurrency = parseCurrencyFromURLParameter(parsedQs.outputCurrency)
  const typedValue = parseTokenAmountURLParameter(parsedQs.exactAmount)
  const independentField = parseIndependentFieldURLParameter(parsedQs.exactField)

  if (inputCurrency === '' && outputCurrency === '' && typedValue === '' && independentField === Field.INPUT) {
    // Defaults to having the native currency selected
    inputCurrency = 'ETH'
  } else if (inputCurrency === outputCurrency) {
    // clear output if identical
    outputCurrency = ''
  }

  const recipient = validatedRecipient(parsedQs.recipient)

  return {
    [Field.INPUT]: {
      currencyId: inputCurrency === '' ? null : inputCurrency ?? null,
    },
    [Field.OUTPUT]: {
      currencyId: outputCurrency === '' ? null : outputCurrency ?? null,
    },
    typedValue,
    independentField,
    recipient,
  }
}

// updates the swap state to use the defaults for a given network
export function useDefaultsFromURLSearch(): SwapState {
  const { chainId } = useAccountDetails()
  const dispatch = useAppDispatch()
  const parsedQs = useParsedQueryString()

  const parsedSwapState = useMemo(() => queryParametersToSwapState(parsedQs), [parsedQs])
  useEffect(() => {
    if (!chainId) {
      return
    }
    const inputCurrencyId = parsedSwapState[Field.INPUT].currencyId ?? undefined
    const outputCurrencyId = parsedSwapState[Field.OUTPUT].currencyId ?? undefined

    dispatch(
      replaceSwapState({
        typedValue: parsedSwapState.typedValue,
        field: parsedSwapState.independentField,
        inputCurrencyId,
        outputCurrencyId,
        recipient: parsedSwapState.recipient,
      })
    )
  }, [dispatch, chainId, parsedSwapState])

  return parsedSwapState
}
