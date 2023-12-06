import { useAccountDetails } from 'hooks/starknet-react'
import { Navigate, useParams } from 'react-router-dom'

import { WRAPPED_NATIVE_CURRENCY } from '../../constants/tokens'
import AddLiquidity from './index'
import { useAccountDetails } from 'hooks/starknet-react'

export default function RedirectDuplicateTokenIds() {
  const { currencyIdA, currencyIdB } = useParams<{ currencyIdA: string; currencyIdB: string; feeAmount?: string }>()

  const { chainId } = useAccountDetails()

  // prevent weth + eth
  const isETHOrWETHA =
    currencyIdA === 'ETH' || (chainId !== undefined && currencyIdA === WRAPPED_NATIVE_CURRENCY[chainId]?.address)
  const isETHOrWETHB =
    currencyIdB === 'ETH' || (chainId !== undefined && currencyIdB === WRAPPED_NATIVE_CURRENCY[chainId]?.address)

  if (
    currencyIdA &&
    currencyIdB &&
    (currencyIdA.toLowerCase() === currencyIdB.toLowerCase() || (isETHOrWETHA && isETHOrWETHB))
  ) {
    return <Navigate to={`/add/${currencyIdA}`} replace />
  }
  return <AddLiquidity />
}
