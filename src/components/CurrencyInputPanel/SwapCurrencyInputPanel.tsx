import { Trans } from '@lingui/macro'
import { Currency, CurrencyAmount, Percent } from '@vnaysn/jediswap-sdk-core'
import { Pair } from '@vnaysn/jediswap-sdk-v2'
import { useAccountBalance, useAccountDetails } from 'hooks/starknet-react'
import ms from 'ms'
import { darken } from 'polished'
import { forwardRef, ReactNode, useCallback, useEffect, useState } from 'react'
import { Lock } from 'react-feather'
import styled, { useTheme } from 'styled-components'

import { AutoColumn } from 'components/Column'
import { LoadingOpacityContainer, loadingOpacityMixin } from 'components/Loader/styled'
import CurrencyLogo from 'components/Logo/CurrencyLogo'
import PrefetchBalancesWrapper from 'components/PrefetchBalancesWrapper/PrefetchBalancesWrapper'
import Tooltip from 'components/Tooltip'
import { isSupportedChain } from 'constants/chains'
import { ThemedText } from 'theme/components'
import { flexColumnNoWrap, flexRowNoWrap } from 'theme/styles'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { ReactComponent as DropDown } from '../../assets/images/dropdown.svg'
import { useCurrencyBalance } from '../../state/connection/hooks'
import { BaseButton, ButtonGray } from '../Button'
import DoubleCurrencyLogo from '../DoubleLogo'
import { Input as NumericalInput } from '../NumericalInput'
import { RowBetween, RowFixed } from '../Row'
import CurrencySearchModal from '../SearchModal/CurrencySearchModal'
import { FiatValue } from './FiatValue'

const InputPanel = styled.div<{ hideInput?: boolean }>`
  ${flexColumnNoWrap};
  position: relative;
  border-radius: ${({ hideInput }) => (hideInput ? '16px' : '20px')};
  z-index: 1;
  width: ${({ hideInput }) => (hideInput ? '100%' : 'initial')};
  transition: height 1s ease;
  will-change: height;
`

const FixedContainer = styled.div`
  width: 100%;
  height: 100%;
  position: absolute;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
`

const Container = styled.div<{ hideInput: boolean }>`
  min-height: 44px;
  border-radius: ${({ hideInput }) => (hideInput ? '16px' : '20px')};
  width: ${({ hideInput }) => (hideInput ? '100%' : 'initial')};
  display: flex;
  flex-direction: column;
  row-gap: 12px;
`

const CurrencySelect = styled(BaseButton)<{
  visible: boolean
  selected: boolean
  hideInput?: boolean
  disabled?: boolean
  animateShake?: boolean
}>`
  align-items: center;
  background-color: ${({ theme }) => theme.jediNavyBlue};
  opacity: ${({ disabled }) => (!disabled ? 1 : 0.4)};
  color: ${({ selected, theme }) => (selected ? theme.neutral1 : theme.white)};
  cursor: pointer;
  height: 40px;
  border-radius: 8px;
  outline: none;
  user-select: none;
  border: 1px solid ${({ selected, theme }) => (selected ? '#fff' : 'transparent')};
  font-size: 14px;
  font-weight: 500;
  width: ${({ hideInput }) => (hideInput ? '100%' : 'initial')};
  padding: 0 8px;
  gap: 8px;
  justify-content: space-between;
  margin-right: ${({ hideInput }) => (hideInput ? '0' : '12px')};
  box-shadow: ${({ theme }) => theme.deprecated_shallowShadow};

  &:hover,
  &:active {
    border: 1px solid #fff;
  }

  &:before {
    background-size: 100%;
    border-radius: inherit;

    position: absolute;
    top: 0;
    left: 0;

    width: 100%;
    height: 100%;
    content: '';
  }

  visibility: ${({ visible }) => (visible ? 'visible' : 'hidden')};

  @keyframes horizontal-shaking {
    0% {
      transform: translateX(0);
      animation-timing-function: ease-in-out;
    }
    20% {
      transform: translateX(10px);
      animation-timing-function: ease-in-out;
    }
    40% {
      transform: translateX(-10px);
      animation-timing-function: ease-in-out;
    }
    60% {
      transform: translateX(10px);
      animation-timing-function: ease-in-out;
    }
    80% {
      transform: translateX(-10px);
      animation-timing-function: ease-in-out;
    }
    100% {
      transform: translateX(0);
      animation-timing-function: ease-in-out;
    }
  }
  animation: ${({ animateShake }) => (animateShake ? 'horizontal-shaking 300ms' : 'none')};
`

const InputRow = styled.div`
  ${flexRowNoWrap};
  align-items: center;
  justify-content: space-between;
`

const LabelRow = styled.div`
  ${flexRowNoWrap};
  align-items: center;
  color: ${({ theme }) => theme.neutral2};
  font-size: 0.75rem;
  line-height: 1rem;

  span:hover {
    cursor: pointer;
    color: ${({ theme }) => darken(0.2, theme.neutral2)};
  }
`

const FiatRow = styled(LabelRow)`
  justify-content: flex-end;
  //min-height: 24px;
`

const Aligner = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`

const StyledDropDown = styled(DropDown)<{ selected: boolean }>`
  margin: 0;
  height: 35%;
  margin-left: 8px;

  path {
    stroke: ${({ selected, theme }) => (selected ? theme.neutral1 : theme.white)};
    stroke-width: 2px;
  }
`

const StyledTokenName = styled.span<{ active?: boolean }>`
  ${({ active }) => (active ? '  margin: 0 0.25rem 0 0.25rem;' : '  margin: 0 0.25rem 0 0.25rem;')}
  font-size: 14px;
  font-weight: 500;
`

const StyledBalanceMax = styled.button<{ disabled?: boolean }>`
  border-radius: 4px;
  border: 1px solid #fff;
  background: transparent;
  color: ${({ theme }) => theme.neutral1};
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  font-weight: 400;
  opacity: ${({ disabled }) => (!disabled ? 1 : 0.4)};
  padding: 4px 12px;
  text-transform: uppercase;
  pointer-events: ${({ disabled }) => (!disabled ? 'initial' : 'none')};

  :hover {
    opacity: ${({ disabled }) => (!disabled ? 0.8 : 0.4)};
  }

  :focus {
    outline: none;
  }
`

const StyledNumericalInput = styled(NumericalInput)<{ $loading: boolean }>`
  ${loadingOpacityMixin};
  text-align: right;
  font-size: 36px;
  font-weight: 485;
  max-height: 44px;
`

interface SwapCurrencyInputPanelProps {
  value: string
  onUserInput: (value: string) => void
  onMax?: () => void
  showMaxButton: boolean
  label: ReactNode
  onCurrencySelect?: (currency: Currency) => void
  currency?: Currency | null
  hideBalance?: boolean
  pair?: Pair | null
  hideInput?: boolean
  otherCurrency?: Currency | null
  usdPriceDifference?: number | undefined
  fiatValue?: number
  priceImpact?: Percent
  id: string
  showCommonBases?: boolean
  showCurrencyAmount?: boolean
  disableNonToken?: boolean
  renderBalance?: (amount: CurrencyAmount<Currency>) => ReactNode
  locked?: boolean
  loading?: boolean
  disabled?: boolean
  numericalInputSettings?: {
    disabled?: boolean
    onDisabledClick?: () => void
    disabledTooltipBody?: ReactNode
  }
}

const SwapCurrencyInputPanel = forwardRef<HTMLInputElement, SwapCurrencyInputPanelProps>(
  (
    {
      value,
      onUserInput,
      onMax,
      showMaxButton,
      onCurrencySelect,
      currency,
      otherCurrency,
      usdPriceDifference,
      id,
      showCommonBases,
      showCurrencyAmount,
      disableNonToken,
      renderBalance,
      fiatValue,
      priceImpact,
      hideBalance = false,
      pair = null, // used for double token logo
      hideInput = false,
      locked = false,
      loading = false,
      disabled = false,
      numericalInputSettings,
      label,
      ...rest
    },
    ref
  ) => {
    const [modalOpen, setModalOpen] = useState(false)
    const { address: account, chainId } = useAccountDetails()
    // const selectedCurrencyBalance = useCurrencyBalance(account ?? undefined, currency ?? undefined)
    const theme = useTheme()
    const { formatCurrencyAmount } = useFormatter()

    const handleDismissSearch = useCallback(() => {
      setModalOpen(false)
    }, [setModalOpen])

    const [tooltipVisible, setTooltipVisible] = useState(false)
    const handleDisabledNumericalInputClick = useCallback(() => {
      if (numericalInputSettings?.disabled && !tooltipVisible) {
        setTooltipVisible(true)
        setTimeout(() => setTooltipVisible(false), ms('4s')) // reset shake animation state after 4s
        numericalInputSettings.onDisabledClick?.()
      }
    }, [tooltipVisible, numericalInputSettings])

    const chainAllowed = isSupportedChain(chainId)

    const { formatted } = useAccountBalance(currency as Currency)

    // reset tooltip state when currency changes
    useEffect(() => setTooltipVisible(false), [currency])

    return (
      <InputPanel id={id} hideInput={hideInput} {...rest}>
        {locked && (
          <FixedContainer>
            <AutoColumn gap="sm" justify="center">
              <Lock />
              <ThemedText.BodySecondary fontSize="12px" textAlign="center" padding="0 12px">
                <Trans>The market price is outside your specified price range. Single-asset deposit only.</Trans>
              </ThemedText.BodySecondary>
            </AutoColumn>
          </FixedContainer>
        )}

        <Container hideInput={hideInput}>
          <RowBetween align={'center'} height={'25px'}>
            <ThemedText.SubHeaderSmall style={{ userSelect: 'none', textTransform: 'uppercase' }}>
              {label}
            </ThemedText.SubHeaderSmall>
            {/* {showMaxButton && selectedCurrencyBalance ? ( */}
            {showMaxButton ? (
              <StyledBalanceMax onClick={onMax}>
                <Trans>Max</Trans>
              </StyledBalanceMax>
            ) : null}
          </RowBetween>
          <InputRow style={hideInput ? { padding: '0', borderRadius: '8px' } : {}}>
            <PrefetchBalancesWrapper shouldFetchOnAccountUpdate={modalOpen}>
              <Tooltip
                show={tooltipVisible && !modalOpen}
                placement="bottom"
                offsetY={14}
                text={numericalInputSettings?.disabledTooltipBody}
              >
                <CurrencySelect
                  disabled={!chainAllowed || disabled}
                  visible={currency !== undefined}
                  selected={!!currency}
                  hideInput={hideInput}
                  className="open-currency-select-button"
                  onClick={() => {
                    if (onCurrencySelect) {
                      setModalOpen(true)
                    }
                  }}
                  animateShake={tooltipVisible}
                >
                  <Aligner>
                    <RowFixed>
                      {pair ? (
                        <span style={{ marginRight: '0.5rem' }}>
                          <DoubleCurrencyLogo currency0={pair.token0} currency1={pair.token1} size={24} margin />
                        </span>
                      ) : currency ? (
                        <CurrencyLogo style={{ marginRight: '2px' }} currency={currency} size="24px" />
                      ) : null}
                      {pair ? (
                        <StyledTokenName className="pair-name-container">
                          {pair?.token0.symbol}:{pair?.token1.symbol}
                        </StyledTokenName>
                      ) : (
                        <StyledTokenName
                          className="token-symbol-container"
                          active={Boolean(currency && currency.symbol)}
                        >
                          {(currency && currency.symbol && currency.symbol.length > 20
                            ? `${currency.symbol.slice(0, 4)}...${currency.symbol.slice(
                                currency.symbol.length - 5,
                                currency.symbol.length
                              )}`
                            : currency?.symbol) || <Trans>Select token</Trans>}
                        </StyledTokenName>
                      )}
                    </RowFixed>
                    {onCurrencySelect && <StyledDropDown selected={!!currency} />}
                  </Aligner>
                </CurrencySelect>
              </Tooltip>
            </PrefetchBalancesWrapper>
            {!hideInput && (
              <div style={{ display: 'flex', flexGrow: '1' }} onClick={handleDisabledNumericalInputClick}>
                <StyledNumericalInput
                  className="token-amount-input"
                  value={value}
                  onUserInput={onUserInput}
                  disabled={!chainAllowed || disabled || numericalInputSettings?.disabled}
                  $loading={loading}
                  id={id}
                  ref={ref}
                />
              </div>
            )}
          </InputRow>
          {!(hideInput && hideBalance) && (
            <FiatRow>
              <RowBetween>
                {account ? (
                  <RowFixed style={{ height: '16px' }}>
                    <ThemedText.LabelSmall color={'neutral1'}>
                      {currency && Boolean(formatted) && <>Bal: {formatted}</>} {/*formatted can be NaN*/}
                    </ThemedText.LabelSmall>
                  </RowFixed>
                ) : (
                  <span />
                )}
                <LoadingOpacityContainer $loading={loading}>
                  {fiatValue === 0 || (parseFloat(value) && fiatValue === undefined)
                    ? 'N/A'
                    : fiatValue && <FiatValue fiatValue={fiatValue} usdPriceDifference={usdPriceDifference} />}
                </LoadingOpacityContainer>
              </RowBetween>
            </FiatRow>
          )}
        </Container>
        {onCurrencySelect && (
          <CurrencySearchModal
            isOpen={modalOpen}
            onDismiss={handleDismissSearch}
            onCurrencySelect={onCurrencySelect}
            selectedCurrency={currency}
            otherSelectedCurrency={otherCurrency}
            showCommonBases={showCommonBases}
            showCurrencyAmount={showCurrencyAmount}
            disableNonToken={disableNonToken}
          />
        )}
      </InputPanel>
    )
  }
)
SwapCurrencyInputPanel.displayName = 'SwapCurrencyInputPanel'

export default SwapCurrencyInputPanel
