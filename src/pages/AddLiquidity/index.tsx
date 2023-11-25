import { BigNumber } from '@ethersproject/bignumber'
import type { TransactionResponse } from '@ethersproject/providers'
import { Trans } from '@lingui/macro'
import { BrowserEvent, InterfaceElementName, InterfaceEventName, LiquidityEventName } from '@uniswap/analytics-events'
import { Currency, CurrencyAmount, Percent, TokenAmount, WETH, currencyEquals } from '@jediswap/sdk'
import { FeeAmount, NonfungiblePositionManager } from '@uniswap/v3-sdk'
import { useWeb3React } from '@web3-react/core'
import { sendAnalyticsEvent, TraceEvent, useTrace } from 'analytics'
import { useToggleAccountDrawer } from 'components/AccountDrawer'
import OwnershipWarning from 'components/addLiquidity/OwnershipWarning'
import UnsupportedCurrencyFooter from 'components/swap/UnsupportedCurrencyFooter'
import { isSupportedChain } from 'constants/chains'
import usePrevious from 'hooks/usePrevious'
import { useSingleCallResult } from 'lib/hooks/multicall'
import { BodyWrapper } from 'pages/AppBody'
import { PositionPageUnsupportedContent } from 'pages/Pool/PositionPage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'react-feather'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Text } from 'rebass'
// import {
//   useRangeHopCallbacks,
//   useV3DerivedMintInfo,
//   useV3MintActionHandlers,
//   useV3MintState,
// } from 'state/mint/hooks'
import styled, { useTheme } from 'styled-components'
import { ThemedText } from 'theme/components'
import { addressesAreEquivalent } from 'utils/addressesAreEquivalent'
import { WrongChainError } from 'utils/errors'

import { ButtonError, ButtonLight, ButtonPrimary, ButtonText } from '../../components/Button'
import { BlueCard, OutlineCard, YellowCard } from '../../components/Card'
import { AutoColumn } from '../../components/Column'
import CurrencyInputPanel from '../../components/CurrencyInputPanel'
import FeeSelector from '../../components/FeeSelector'
import HoverInlineText from '../../components/HoverInlineText'
import LiquidityChartRangeInput from '../../components/LiquidityChartRangeInput'
import { AddRemoveTabs } from '../../components/NavigationTabs'
import { PositionPreview } from '../../components/PositionPreview'
import RangeSelector from '../../components/RangeSelector'
import PresetsButtons from '../../components/RangeSelector/PresetsButtons'
import RateToggle from '../../components/RateToggle'
import Row, { RowBetween, RowFixed } from '../../components/Row'
import { SwitchLocaleLink } from '../../components/SwitchLocaleLink'
import TransactionConfirmationModal, { ConfirmationModalContent } from '../../components/TransactionConfirmationModal'
import { ZERO_PERCENT } from '../../constants/misc'
import { WRAPPED_NATIVE_CURRENCY } from '../../constants/tokens'
import { useAllTokens, useCurrency } from '../../hooks/Tokens'
import { ApprovalState, useApproveCallback } from '../../hooks/useApproveCallback'
// import { useArgentWalletContract } from '../../hooks/useArgentWalletContract'
// import { useV3NFTPositionManagerContract } from '../../hooks/useContract'
import { useDerivedPositionInfo } from '../../hooks/useDerivedPositionInfo'
import { useIsSwapUnsupported } from '../../hooks/useIsSwapUnsupported'
import { useStablecoinValue } from '../../hooks/useStablecoinPrice'
import useTransactionDeadline from '../../hooks/useTransactionDeadline'
import { useV3PositionFromTokenId } from '../../hooks/useV3Positions'
import { Bound, Field } from '../../state/mint/actions'
import { useTransactionAdder } from '../../state/transactions/hooks'
import { TransactionInfo, TransactionType } from '../../state/transactions/types'
// import { useUserSlippageToleranceWithDefault } from '../../state/user/hooks'
import approveAmountCalldata from '../../utils/approveAmountCalldata'
import { calculateGasMargin } from '../../utils/calculateGasMargin'
import { currencyId } from '../../utils/currencyId'
import { maxAmountSpend } from '../../utils/maxAmountSpend'
import { Dots } from '../Pool/styled'
import { Review } from './Review'
import { DynamicSection, MediumOnly, ResponsiveTwoColumns, ScrollablePage, StyledInput, Wrapper } from './styled'
import { useAccountDetails } from 'hooks/starknet-react'
import { useDerivedMintInfo, useMintActionHandlers, useMintState } from 'state/mint/hooks'
import { useBalance } from '@starknet-react/core'

// const DEFAULT_ADD_IN_RANGE_SLIPPAGE_TOLERANCE = new Percent(50, 10_000)

const StyledBodyWrapper = styled(BodyWrapper)<{ $hasExistingPosition: boolean }>`
  padding: ${({ $hasExistingPosition }) => ($hasExistingPosition ? '10px' : 0)};
  max-width: 640px;
`

export default function AddLiquidity() {
  const navigate = useNavigate()
  const {
    currencyIdA,
    currencyIdB,
    feeAmount: feeAmountFromUrl,
    tokenId,
  } = useParams<{
    currencyIdA?: string
    currencyIdB?: string
    feeAmount?: string
    tokenId?: string
  }>()
  const { account, chainId, address } = useAccountDetails()
  const theme = useTheme()
  const trace = useTrace()
  const toggleWalletDrawer = useToggleAccountDrawer() // toggle wallet when disconnected
  const addTransaction = useTransactionAdder()

  // fee selection from url
  const feeAmount: FeeAmount | undefined =
    feeAmountFromUrl && Object.values(FeeAmount).includes(parseFloat(feeAmountFromUrl))
      ? parseFloat(feeAmountFromUrl)
      : undefined

  const baseCurrency = useCurrency(currencyIdA)
  const currencyB = useCurrency(currencyIdB)
  // prevent an error if they input ETH/WETH

  const quoteCurrency =
    chainId &&
    ((baseCurrency && currencyEquals(baseCurrency, WETH[chainId])) ||
      (currencyB && currencyEquals(currencyB, WETH[chainId])))
      ? undefined
      : currencyB

  // const quoteCurrency = {
  //   name: 'USDCoin',
  //   symbol: 'USDC',
  //   decimals: 6,
  //   logoURI:
  //     'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  // }

  // mint state
  const { independentField, typedValue, otherTypedValue } = useMintState()

  const {
    dependentField,
    currencies,
    pair,
    pairState,
    parsedAmounts,
    price,
    noLiquidity,
    liquidityMinted,
    poolTokenPercentage,
    error,
  } = useDerivedMintInfo(baseCurrency ?? undefined, currencyB ?? undefined)

  const hasExistingPosition = false
  const isValid = !error

  // const { isLoading, isError, error, data } = useBalance({
  //   address,
  //   watch: true,
  // })

  const { onFieldAInput, onFieldBInput, onLeftRangeInput, onRightRangeInput } = useMintActionHandlers(noLiquidity)

  // modal and loading
  const [showConfirm, setShowConfirm] = useState<boolean>(false)
  const [attemptingTxn, setAttemptingTxn] = useState<boolean>(false) // clicked confirm

  // txn values
  const deadline = useTransactionDeadline() // custom from users settings

  const [txHash, setTxHash] = useState<string>('')

  // get formatted amounts
  const formattedAmounts = {
    [independentField]: typedValue,
    [dependentField]: parsedAmounts[dependentField]?.toSignificant(6) ?? '',
  }

  // get the max amounts user can add
  const maxAmounts: { [field in Field]?: TokenAmount } = [Field.CURRENCY_A, Field.CURRENCY_B].reduce(
    (accumulator, field) => {
      return {
        ...accumulator,
      }
    },
    {}
  )

  const atMaxAmounts: { [field in Field]?: CurrencyAmount } = [Field.CURRENCY_A, Field.CURRENCY_B].reduce(
    (accumulator, field) => {
      return {
        ...accumulator,
        [field]: maxAmounts[field]?.equalTo(parsedAmounts[field] ?? '0'),
      }
    },
    {}
  )

  const handleCurrencyASelect = useCallback(
    (currencyA: Currency) => {
      const newCurrencyIdA = currencyId(currencyA)
      if (newCurrencyIdA === currencyIdB) {
        navigate(`/add/${currencyIdB}/${currencyIdA}`)
      } else {
        navigate(`/add/${newCurrencyIdA}/${currencyIdB}`)
      }
    },
    [currencyIdB, history, currencyIdA]
  )
  const handleCurrencyBSelect = useCallback(
    (currencyB: Currency) => {
      const newCurrencyIdB = currencyId(currencyB)

      if (currencyIdA === newCurrencyIdB) {
        if (currencyIdB) {
          navigate(`/add/${currencyIdB}/${newCurrencyIdB}`)
        } else {
          navigate(`/add/${newCurrencyIdB}`)
        }
      } else {
        navigate(`/add/${currencyIdA ? currencyIdA : 'ETH'}/${newCurrencyIdB}`)
      }
    },
    [currencyIdA, history, currencyIdB]
  )

  const handleFeePoolSelect = useCallback((newFeeAmount: FeeAmount) => {
    onLeftRangeInput('')
    onRightRangeInput('')
    navigate(`/add/${currencyIdA}/${currencyIdB}/${newFeeAmount}`)
  }, [])

  const clearAll = useCallback(() => {
    onFieldAInput('')
    onFieldBInput('')
    onLeftRangeInput('')
    onRightRangeInput('')
    navigate(`/add`)
  }, [navigate, onFieldAInput, onFieldBInput, onLeftRangeInput, onRightRangeInput])

  const Buttons = () =>
    !account ? (
      <TraceEvent
        events={[BrowserEvent.onClick]}
        name={InterfaceEventName.CONNECT_WALLET_BUTTON_CLICKED}
        properties={{ received_swap_quote: false }}
        element={InterfaceElementName.CONNECT_WALLET_BUTTON}
      >
        <ButtonLight onClick={toggleWalletDrawer} $borderRadius="12px" padding="12px">
          <Trans>Connect wallet</Trans>
        </ButtonLight>
      </TraceEvent>
    ) : (
      <AutoColumn gap="md">
        <ButtonError
          onClick={() => {
            setShowConfirm(true)
          }}
          disabled={!isValid}
          error={!isValid && !!parsedAmounts[Field.CURRENCY_A] && !!parsedAmounts[Field.CURRENCY_B]}
        >
          <Text fontWeight={535}>{error ? error : <Trans>Preview</Trans>}</Text>
        </ButtonError>
      </AutoColumn>
    )

  return (
    <>
      <ScrollablePage>
        {/*  <TransactionConfirmationModal
          isOpen={showConfirm}
          onDismiss={handleDismissConfirmation}
          attemptingTxn={attemptingTxn}
          hash={txHash}
          reviewContent={() => (
            <ConfirmationModalContent
              title={<Trans>Add Liquidity</Trans>}
              onDismiss={handleDismissConfirmation}
              topContent={() => (
                <Review
                  parsedAmounts={parsedAmounts}
                  position={position}
                  existingPosition={existingPosition}
                  priceLower={priceLower}
                  priceUpper={priceUpper}
                  outOfRange={outOfRange}
                  ticksAtLimit={ticksAtLimit}
                />
              )}
              bottomContent={() => (
                <ButtonPrimary style={{ marginTop: '1rem' }} onClick={onAdd}>
                  <Text fontWeight={535} fontSize={20}>
                    <Trans>Add</Trans>
                  </Text>
                </ButtonPrimary>
              )}
            />
          )}
          pendingText={pendingText}
        /> */}
        <StyledBodyWrapper $hasExistingPosition={hasExistingPosition}>
          <AddRemoveTabs
            creating={false}
            adding={true}
            positionID={tokenId}
            // autoSlippage={DEFAULT_ADD_IN_RANGE_SLIPPAGE_TOLERANCE}
            showBackLink={!hasExistingPosition}
          >
            {!hasExistingPosition && (
              <Row justifyContent="flex-end" style={{ width: 'fit-content', minWidth: 'fit-content' }}>
                <MediumOnly>
                  <ButtonText onClick={clearAll}>
                    <ThemedText.DeprecatedBlue fontSize="12px">
                      <Trans>Clear all</Trans>
                    </ThemedText.DeprecatedBlue>
                  </ButtonText>
                </MediumOnly>
              </Row>
            )}
          </AddRemoveTabs>
          <Wrapper>
            <ResponsiveTwoColumns wide={true}>
              <AutoColumn gap="lg">
                {/* {!hasExistingPosition && ( */}
                <>
                  <AutoColumn gap="md">
                    <RowBetween paddingBottom="20px">
                      <ThemedText.DeprecatedLabel>
                        <Trans>Select pair</Trans>
                      </ThemedText.DeprecatedLabel>
                    </RowBetween>
                    <RowBetween gap="md">
                      <CurrencyInputPanel
                        value={formattedAmounts[Field.CURRENCY_A]}
                        onUserInput={onFieldAInput}
                        hideInput
                        onMax={() => {
                          onFieldAInput(maxAmounts[Field.CURRENCY_A]?.toExact() ?? '')
                        }}
                        onCurrencySelect={handleCurrencyASelect}
                        showMaxButton={!atMaxAmounts[Field.CURRENCY_A]}
                        currency={currencies[Field.CURRENCY_A] ?? null}
                        id="add-liquidity-input-tokena"
                        showCommonBases
                      />

                      <CurrencyInputPanel
                        value={formattedAmounts[Field.CURRENCY_B]}
                        hideInput
                        onUserInput={onFieldBInput}
                        onCurrencySelect={handleCurrencyBSelect}
                        onMax={() => {
                          onFieldBInput(maxAmounts[Field.CURRENCY_B]?.toExact() ?? '')
                        }}
                        showMaxButton={!atMaxAmounts[Field.CURRENCY_B]}
                        currency={currencies[Field.CURRENCY_B] ?? null}
                        id="add-liquidity-input-tokenb"
                        showCommonBases
                      />
                    </RowBetween>

                    <FeeSelector
                      disabled={!baseCurrency || !quoteCurrency}
                      feeAmount={500}
                      handleFeePoolSelect={handleFeePoolSelect}
                      // currencyA={baseCurrency ?? undefined}
                      // currencyB={quoteCurrency ?? undefined}
                    />
                  </AutoColumn>{' '}
                </>

                {/* {hasExistingPosition && existingPosition && (
                  <PositionPreview
                    position={existingPosition}
                    title={<Trans>Selected range</Trans>}
                    inRange={!outOfRange}
                    ticksAtLimit={ticksAtLimit}
                  />
                )} */}
              </AutoColumn>

              {!hasExistingPosition && (
                <>
                  <DynamicSection gap="md" disabled={!feeAmount}>
                    <RowBetween>
                      <ThemedText.DeprecatedLabel>
                        <Trans>Set price range</Trans>
                      </ThemedText.DeprecatedLabel>

                      {baseCurrency && quoteCurrency && (
                        <RowFixed gap="8px">
                          <RateToggle
                            currencyA={baseCurrency}
                            currencyB={quoteCurrency}
                            // handleRateToggle={() => {
                            //   if (!ticksAtLimit[Bound.LOWER] && !ticksAtLimit[Bound.UPPER]) {
                            //     onLeftRangeInput(
                            //       (invertPrice ? priceLower : priceUpper?.invert())?.toSignificant(6) ?? ''
                            //     )
                            //     onRightRangeInput(
                            //       (invertPrice ? priceUpper : priceLower?.invert())?.toSignificant(6) ?? ''
                            //     )
                            //     onFieldAInput(formattedAmounts[Field.CURRENCY_B] ?? '')
                            //   }
                            //   navigate(
                            //     `/add/${currencyIdB as string}/${currencyIdA as string}${
                            //       feeAmount ? '/' + feeAmount : ''
                            //     }`
                            //   )
                            // }}
                          />
                        </RowFixed>
                      )}
                    </RowBetween>

                    <RangeSelector
                      // priceLower={priceLower}
                      // priceUpper={priceUpper}
                      onLeftRangeInput={onLeftRangeInput}
                      onRightRangeInput={onRightRangeInput}
                      currencyA={baseCurrency}
                      currencyB={quoteCurrency}
                      feeAmount={feeAmount}
                      // ticksAtLimit={ticksAtLimit}
                    />

                    {/* {outOfRange && (
                      <YellowCard padding="8px 12px" $borderRadius="12px">
                        <RowBetween>
                          <AlertTriangle stroke={theme.deprecated_yellow3} size="16px" />
                          <ThemedText.DeprecatedYellow ml="12px" fontSize="12px">
                            <Trans>
                              Your position will not earn fees or be used in trades until the market price moves into
                              your range.
                            </Trans>
                          </ThemedText.DeprecatedYellow>
                        </RowBetween>
                      </YellowCard>
                    )}

                    {invalidRange && (
                      <YellowCard padding="8px 12px" $borderRadius="12px">
                        <RowBetween>
                          <AlertTriangle stroke={theme.deprecated_yellow3} size="16px" />
                          <ThemedText.DeprecatedYellow ml="12px" fontSize="12px">
                            <Trans>Invalid range selected. The min price must be lower than the max price.</Trans>
                          </ThemedText.DeprecatedYellow>
                        </RowBetween>
                      </YellowCard>
                    )} */}
                  </DynamicSection>

                  <DynamicSection gap="md" disabled={!feeAmount}>
                    {/* {Boolean(price && baseCurrency && quoteCurrency && !noLiquidity) && ( */}
                    <AutoColumn gap="2px" style={{ marginTop: '0.5rem' }}>
                      <Trans>
                        <ThemedText.DeprecatedMain fontWeight={535} fontSize={12} color="text1">
                          Current price:
                        </ThemedText.DeprecatedMain>
                        <ThemedText.DeprecatedBody fontWeight={535} fontSize={20} color="text1">
                          {/* {price && (
                                  <HoverInlineText
                                    maxCharacters={20}
                                    text={invertPrice ? price.invert().toSignificant(6) : price.toSignificant(6)}
                                  />
                                )} */}
                        </ThemedText.DeprecatedBody>
                        {baseCurrency && (
                          <ThemedText.DeprecatedBody color="text2" fontSize={12}>
                            {quoteCurrency?.symbol} per {baseCurrency.symbol}
                          </ThemedText.DeprecatedBody>
                        )}
                      </Trans>
                    </AutoColumn>
                    {/* )} */}
                    {/* <LiquidityChartRangeInput
                          currencyA={baseCurrency ?? undefined}
                          currencyB={quoteCurrency ?? undefined}
                          feeAmount={feeAmount}
                          ticksAtLimit={ticksAtLimit}
                          price={
                            price ? parseFloat((invertPrice ? price.invert() : price).toSignificant(8)) : undefined
                          }
                          priceLower={priceLower}
                          priceUpper={priceUpper}
                          onLeftRangeInput={onLeftRangeInput}
                          onRightRangeInput={onRightRangeInput}
                          interactive={!hasExistingPosition}
                        /> */}
                  </DynamicSection>
                </>
              )}
              <div>
                <DynamicSection
                //  disabled={invalidRange || (noLiquidity && !startPriceTypedValue)}
                >
                  <AutoColumn gap="md">
                    <ThemedText.DeprecatedLabel>
                      {hasExistingPosition ? <Trans>Add more liquidity</Trans> : <Trans>Deposit amounts</Trans>}
                    </ThemedText.DeprecatedLabel>

                    <CurrencyInputPanel
                      value={formattedAmounts[Field.CURRENCY_A]}
                      onUserInput={onFieldAInput}
                      onMax={() => {
                        onFieldAInput(maxAmounts[Field.CURRENCY_A]?.toExact() ?? '')
                      }}
                      showMaxButton={!atMaxAmounts[Field.CURRENCY_A]}
                      currency={currencies[Field.CURRENCY_A] ?? null}
                      id="add-liquidity-input-tokena"
                      // fiatValue={currencyAFiat}
                      showCommonBases
                      // locked={depositADisabled}
                    />

                    <CurrencyInputPanel
                      value={formattedAmounts[Field.CURRENCY_B]}
                      onUserInput={onFieldBInput}
                      onMax={() => {
                        onFieldBInput(maxAmounts[Field.CURRENCY_B]?.toExact() ?? '')
                      }}
                      showMaxButton={!atMaxAmounts[Field.CURRENCY_B]}
                      // fiatValue={currencyBFiat}
                      currency={currencies[Field.CURRENCY_B] ?? null}
                      id="add-liquidity-input-tokenb"
                      showCommonBases
                      // locked={depositBDisabled}
                    />
                  </AutoColumn>
                </DynamicSection>
              </div>
              <Buttons />
            </ResponsiveTwoColumns>
          </Wrapper>
        </StyledBodyWrapper>
        {/* {showOwnershipWarning && <OwnershipWarning ownerAddress={owner} />}
        {addIsUnsupported && (
          <UnsupportedCurrencyFooter
            show={addIsUnsupported}
            currencies={[currencies.CURRENCY_A, currencies.CURRENCY_B]}
          />
        )} */}
      </ScrollablePage>
      <SwitchLocaleLink />
    </>
  )
}
