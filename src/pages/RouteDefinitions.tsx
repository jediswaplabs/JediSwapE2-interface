import { lazy, ReactNode, useMemo } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { isBrowserRouterEnabled } from 'utils/env'
import PoolDetails from './PoolDetails'
import Swap from './Swap'
import { RedirectPathToSwapOnly, RedirectToSwap } from './Swap/redirects'
import Vaults from './Vaults'

const AddLiquidity = lazy(() => import('pages/AddLiquidity'))
const Vault = lazy(() => import('pages/Vault'))
// import Rewards from './Rewards'

const RedirectDuplicateTokenIds = lazy(() => import('pages/AddLiquidity/redirects'))

const Pool = lazy(() => import('pages/Pool'))
const PositionPage = lazy(() => import('pages/Pool/PositionPage'))
const RemoveLiquidityV3 = lazy(() => import('pages/RemoveLiquidity/V3'))
const MigrateV1 = lazy(() => import('pages/MigrateV1'))
const MigrateV1Pair = lazy(() => import('pages/MigrateV1/MigrateV1Pair'))

interface RouterConfig {
  browserRouterEnabled?: boolean
  hash?: string
}

/**
 * Convenience hook which organizes the router configuration into a single object.
 */
export function useRouterConfig(): RouterConfig {
  const browserRouterEnabled = isBrowserRouterEnabled()
  const { hash } = useLocation()
  return useMemo(
    () => ({
      browserRouterEnabled,
      hash,
    }),
    [browserRouterEnabled, hash]
  )
}

export interface RouteDefinition {
  path: string
  nestedPaths: string[]
  // eslint-disable-next-line no-unused-vars
  enabled: (args: RouterConfig) => boolean
  // eslint-disable-next-line no-unused-vars
  getElement: (args: RouterConfig) => ReactNode
}

// Assigns the defaults to the route definition.
function createRouteDefinition(route: Partial<RouteDefinition>): RouteDefinition {
  return {
    getElement: () => null,
    enabled: () => true,
    path: '/',
    nestedPaths: [],
    // overwrite the defaults
    ...route,
  }
}

export const routes: RouteDefinition[] = [
  createRouteDefinition({ path: '/swap', getElement: () => <Swap /> }),
  createRouteDefinition({ path: '/swap/:outputCurrency', getElement: () => <RedirectToSwap /> }),
  createRouteDefinition({ path: '/pools', getElement: () => <Pool /> }),
  createRouteDefinition({ path: '/pools/:poolId', getElement: () => <PoolDetails /> }),
  createRouteDefinition({ path: '/pool', getElement: () => <Navigate to="/pools" replace={true} /> }),
  createRouteDefinition({ path: '/pool/:poolId', getElement: () => <PoolDetails /> }),
  createRouteDefinition({ path: '/positions', getElement: () => <Pool /> }),
  createRouteDefinition({ path: '/positions/:tokenId', getElement: () => <PositionPage /> }),
  createRouteDefinition({ path: '/vaults', getElement: () => <Vaults /> }),
  createRouteDefinition({ path: '/vaults/:vaultId', getElement: () => <Vault /> }),
  // createRouteDefinition({ path: '/rewards', getElement: () => <Rewards /> }),
  createRouteDefinition({ path: '/migrate/', getElement: () => <MigrateV1 /> }),
  createRouteDefinition({ path: '/migrate/:address', getElement: () => <MigrateV1Pair /> }),
  createRouteDefinition({
    path: '/add',
    nestedPaths: [':currencyIdA', ':currencyIdA/:currencyIdB', ':currencyIdA/:currencyIdB/:feeAmount'],
    getElement: () => <RedirectDuplicateTokenIds />,
  }),

  createRouteDefinition({
    path: '/increase',
    nestedPaths: [
      ':currencyIdA',
      ':currencyIdA/:currencyIdB',
      ':currencyIdA/:currencyIdB/:feeAmount',
      ':currencyIdA/:currencyIdB/:feeAmount/:tokenId',
    ],
    getElement: () => <AddLiquidity />,
  }),
  createRouteDefinition({ path: '/remove/:tokenId', getElement: () => <RemoveLiquidityV3 /> }),
  // @ts-ignore
  createRouteDefinition({ path: '*', getElement: () => <RedirectPathToSwapOnly /> }),
]
