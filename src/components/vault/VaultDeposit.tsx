/* eslint-disable semi */
import styled, { css } from 'styled-components'
import { useSelector } from 'react-redux'
import { AutoColumn } from 'components/Column'
import CurrencyInputPanel from 'components/CurrencyInputPanel'
import { useVaultActionHandlers, useVaultDerivedInfo, useVaultState } from 'state/vaults/hooks'
import { useCurrency } from 'hooks/Tokens'
import { Field } from 'state/vaults/actions'
import { useAccountDetails } from 'hooks/starknet-react'
import { DEFAULT_CHAIN_ID } from 'constants/tokens'

const DepositWrapper = styled(AutoColumn)`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

function VaultDeposit({ currentVault }: { currentVault: any }) {
  const { onFieldAInput, onFieldBInput } = useVaultActionHandlers()
  const { chainId: chainIdConnected } = useAccountDetails()
  const chainId = chainIdConnected || DEFAULT_CHAIN_ID

  // Vault Input state
  const baseCurrency = useCurrency(currentVault.token0.address, chainId)
  const currencyB = useCurrency(currentVault.token1.address, chainId)
  const vaultState = useSelector((state: any) => state.vaults)

  // vault state state
  const { independentField, typedValue } = useVaultState()
  const { dependentField, currencies, parsedAmounts } = useVaultDerivedInfo(
    vaultState,
    baseCurrency ?? undefined,
    currencyB ?? undefined
  )
  // get formatted amounts
  const formattedAmounts = {
    [independentField]: typedValue,
    [dependentField]: parsedAmounts[dependentField]?.toSignificant(6) ?? '',
  }
  return (
    <DepositWrapper>
      <CurrencyInputPanel
        value={formattedAmounts[Field.CURRENCY_A]}
        onUserInput={onFieldAInput}
        showMaxButton
        currency={currencies[Field.CURRENCY_A] ?? null}
        id="add-liquidity-input-tokena"
      />
      <CurrencyInputPanel
        value={formattedAmounts[Field.CURRENCY_B]}
        onUserInput={onFieldBInput}
        showMaxButton
        currency={currencies[Field.CURRENCY_B] ?? null}
        id="add-liquidity-input-tokena"
      />
    </DepositWrapper>
  )
}

export default VaultDeposit
