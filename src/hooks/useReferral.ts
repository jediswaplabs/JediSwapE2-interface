import { useContractRead } from '@starknet-react/core'
import { useEffect, useMemo } from 'react'
import { useAccountDetails } from './starknet-react'
import { useReferralContract } from './useContractV2'
import { feltArrToStr } from './usePositionTokenURI'
import fetchReferrer from 'api/fetchReferrer'
import useParsedQueryString from './useParsedQueryString'
import { parseReferralCodeURLParameter } from 'state/swap/hooks'
import { ChainId } from '@vnaysn/jediswap-sdk-core'
import { isAddressValidForStarknet } from 'utils/addresses'
import { Call, getChecksumAddress, validateChecksumAddress } from 'starknet'

/* 
  This function is used to fetch the referrer of the user from bloackchain.
  It takes the chain id and the user address as input.
  It returns the referrer of the user.
  It fetches data on every pending block.
  Not used anymore.
*/
export function useTraderReferralCode(): {
  data: any
  error: any
  isLoading: boolean
} {
  const { chainId, address: account } = useAccountDetails()
  const referralContract = useReferralContract()

  const { data, error, isLoading } = useContractRead({
    functionName: 'get_referrer',
    address: referralContract?.address,
    abi: referralContract?.abi,
    args: account ? [account] : undefined,
    watch: true,
    parseResult: true,
    blockIdentifier: 'pending' as any,
    refetchInterval: 10000,
  })

  return useMemo(() => {
    return {
      data: data ? feltArrToStr([data as bigint]) : undefined,
      error,
      isLoading: isLoading,
    }
  }, [chainId, account, data, error, isLoading])
}

export interface ILocalStorageUserData {
  referredBy: string
  onChain: boolean
  isCorrect: boolean
  isNotifClosed: boolean
}
export interface ILocalStorageReferralData {
  [chainId: string]: {
    [userAddress: string]: ILocalStorageUserData
  }
}

const localStoreReferralDataObjectName = 'referralCodeV2'
const noWalletReferralCodeObjectName = 'noWalletReferralCodeV2'

/**
 * This function sets referral data to local storage.
 * @param {string} data - The referral data to be stored. In Json format.
 */
function setReferralDataToLocalStore(data: string, chainId: string) {
  localStorage.setItem(localStoreReferralDataObjectName, data)

  // remove the mainnet or testnet key data pair accordingly from nowalletreferralcode
  const noWalletReferralCode = getNoWalletReferralCodeFromStorage(chainId)
  if (noWalletReferralCode) {
    const newObject = {
      [chainId]: noWalletReferralCode,
    }
    setNoWalletReferralCodeToLocalStore(JSON.stringify(newObject))
  }
}

/**
 * This function sets referral code for no wallet connected state to local storage.
 * @param {string} data - The referral code to be stored. In Json format.
 */
function setNoWalletReferralCodeToLocalStore(data: string) {
  localStorage.setItem(noWalletReferralCodeObjectName, data)
}

/**
 * This function retrieves referral data from local storage.
 * @returns {ILocalStorageReferralData | undefined} The referral data from local storage.
 */
export function getReferralInfoFromStorage() {
  const rawLocalStorageData = localStorage.getItem(localStoreReferralDataObjectName)
  const localStorageData: ILocalStorageReferralData | undefined = rawLocalStorageData && JSON.parse(rawLocalStorageData)
  return localStorageData
}

/**
 * This function retrieves the referral code from local storage for no wallet connected state
 * @returns {Object} The referral code from local storage.
 */

function getNoWalletReferralCodeFromStorage(chainId: string | undefined) {
  const rawLocalStorageData = localStorage.getItem(noWalletReferralCodeObjectName)
  const localStorageData: { [chainId: string]: string } | undefined =
    rawLocalStorageData && JSON.parse(rawLocalStorageData)
  if (localStorageData && chainId) {
    return localStorageData[chainId]
  }
  return undefined
}

/**
 * This function retrieves the referral information from local storage for a specific user.
 * It returns the referralInfoLocal object and the userReferralInfoLocal object.
 * @param {string} chainId - The chain ID of the user.
 * @param {string} userAddress - The address of the user.
 * @returns {Object} The referralInfoLocal object and the userReferralInfoLocal object.
 */
export function getReferralInfoFromLocalStorageForUser(
  chainId?: string,
  userAddress?: string
): { referralInfoLocal: any; userReferralInfoLocal: any } {
  const referralInfoLocal = getReferralInfoFromStorage()
  let userReferralInfoLocal: ILocalStorageUserData | undefined = undefined

  if (referralInfoLocal && chainId && userAddress) {
    userReferralInfoLocal = referralInfoLocal && referralInfoLocal[chainId] && referralInfoLocal[chainId][userAddress]
  }
  return { referralInfoLocal, userReferralInfoLocal }
}

function isChainIdCorrect(chainId: string) {
  return chainId == ChainId.MAINNET || chainId == ChainId.GOERLI
}

/**
 * This hook is used to get the referral state of the user.
 * It checks the local storage for the referral code of the user.
 * If the referral code is not present in the local storage, it fetches the referral code from the blockchain.
 * If the referral code is not present in the local storage and the referral code is present in the URL, it sets the referral code in the local storage.
 * If the referral code is present in the local storage, it checks if the referral code is on-chain or off-chain.
 * If the referral code is off-chain and the referral code is present in the URL, it sets the referral code in the local storage.
 * If the referral code is on-chain, it does not do anything.
 * If user is not connected to the wallet, save the referral code in the local storage - noWalletReferralCode.
 * Upon wallet connection, check noWalletReferralCode and set the referral code in the local storage.
 */
export function useReferralstate() {
  const { chainId, address: account } = useAccountDetails()
  const parsedQs = useParsedQueryString()
  const referralCodeFromUrl = parseReferralCodeURLParameter(parsedQs.referralCode)
  // const isTestnet = parsedQs.testnet == 'true'
  const chainIdFromUrl: unknown = parsedQs.chainId

  useEffect(() => {
    if (chainId && account) {
      const referralCodeFromLocalStorage = getNoWalletReferralCodeFromStorage(chainIdFromUrl as string | undefined)
      if (!referralCodeFromUrl && referralCodeFromLocalStorage) {
        const { referralInfoLocal: referralData, userReferralInfoLocal: localStorageData } =
          getReferralInfoFromLocalStorageForUser(chainId, account)
        if (!localStorageData) {
          const referralCodeObject: ILocalStorageUserData = {
            referredBy: referralCodeFromLocalStorage,
            onChain: false,
            isCorrect: isAddressValidForReferral(account, referralCodeFromLocalStorage),
            isNotifClosed: false,
          }
          if (!referralData) {
            setReferralDataToLocalStore(
              JSON.stringify({ [chainId]: { [account]: referralCodeObject } }),
              chainIdFromUrl as string
            )
          } else {
            const newLocalStorageData = {
              ...referralData,
              [chainId]: {
                ...referralData[chainId],
                [account]: referralCodeObject,
              },
            }
            setReferralDataToLocalStore(JSON.stringify(newLocalStorageData), chainIdFromUrl as string)
          }
        }
      }
      const { referralInfoLocal: referralData, userReferralInfoLocal: localStorageData } =
        getReferralInfoFromLocalStorageForUser(chainId, account)
      if (!localStorageData || localStorageData?.onChain === false || localStorageData?.isCorrect === false) {
        fetchReferrer(chainId, account).then(
          (dataFromBlockChain: { id: number; jsonrpc: string; result: string[] }) => {
            if (dataFromBlockChain.result[0] !== '0x0') {
              const referralCodeObject: ILocalStorageUserData = {
                referredBy: dataFromBlockChain.result[0],
                onChain: true,
                isCorrect: true,
                isNotifClosed: false,
              }

              if (!referralData) {
                setReferralDataToLocalStore(
                  JSON.stringify({ [chainId]: { [account]: referralCodeObject } }),
                  chainIdFromUrl as string
                )
              } else {
                const newLocalStorageData = {
                  ...referralData,
                  [chainId]: {
                    ...referralData[chainId],
                    [account]: referralCodeObject,
                  },
                }
                setReferralDataToLocalStore(JSON.stringify(newLocalStorageData), chainIdFromUrl as string)
              }
            } else if (referralCodeFromUrl && chainIdFromUrl && chainIdFromUrl == chainId) {
              const referralCodeObject: ILocalStorageUserData = {
                referredBy: referralCodeFromUrl,
                onChain: false,
                isCorrect: isAddressValidForReferral(account, referralCodeFromUrl),
                isNotifClosed: false,
              }
              if (!referralData) {
                setReferralDataToLocalStore(
                  JSON.stringify({ [chainId]: { [account]: referralCodeObject } }),
                  chainIdFromUrl as string
                )
              } else {
                const newLocalStorageData = {
                  ...referralData,
                  [chainId]: {
                    ...referralData[chainId],
                    [account]: referralCodeObject,
                  },
                }
                setReferralDataToLocalStore(JSON.stringify(newLocalStorageData), chainIdFromUrl as string)
              }
            }
          }
        )
      }
    } else if (referralCodeFromUrl) {
      const chainId = chainIdFromUrl as string | undefined
      if (!chainId || !isChainIdCorrect(chainId)) return
      const noWalletReferralCode = localStorage.getItem(noWalletReferralCodeObjectName)
      if (!noWalletReferralCode) {
        const newObject = { [chainId]: referralCodeFromUrl }
        setNoWalletReferralCodeToLocalStore(JSON.stringify(newObject))
      } else {
        const newObject = {
          ...JSON.parse(noWalletReferralCode),
          [chainId]: referralCodeFromUrl,
        }
        setNoWalletReferralCodeToLocalStore(JSON.stringify(newObject))
      }
    }
  }, [chainId, account, referralCodeFromUrl, chainIdFromUrl])
}

/**
 * This function is used to check if the address is valid for referral.
 * It checks if the address is valid for starknet.
 * It checks if the address is not same as the user address.
 * It checks if the address is a valid checksum address.
 * @param {string} address - The address to be checked.
 * @returns {boolean} True if the address is valid, false otherwise.
 */
function isAddressValidForReferral(userAddress: string, refereeAddress: string) {
  const validStarknetAddress = isAddressValidForStarknet(refereeAddress)
  return (
    validStarknetAddress !== false &&
    getChecksumAddress(userAddress) != getChecksumAddress(refereeAddress) &&
    (isLowercaseHexAddress(refereeAddress, validStarknetAddress) === true ||
      validateChecksumAddress(refereeAddress) !== false)
  )
}

/** 
  This is done to avoid the user setting the referral code in the URL multiple times.
  If the set_referrer call is successful, the referral code is set in the local storage.
  * @param {string} chainId - The chain ID of the user.
  * @param {string} account - The account of the user.
*/
export function setOnChainReferralTrueForuser(userAddress: string, chainId: ChainId, calls: Call[]) {
  const setReferrerCall = calls.find((call) => call.entrypoint === 'set_referrer')
  if (setReferrerCall) {
    const { referralInfoLocal, userReferralInfoLocal } = getReferralInfoFromLocalStorageForUser(chainId, userAddress)
    if (userReferralInfoLocal && userReferralInfoLocal.onChain === false) {
      const newInfo = {
        ...userReferralInfoLocal,
        onChain: true,
      }

      const newLocalStorageData = {
        ...referralInfoLocal,
        [chainId]: {
          ...referralInfoLocal[chainId],
          [userAddress]: newInfo,
        },
      }
      setReferralDataToLocalStore(JSON.stringify(newLocalStorageData), chainId)
    }
  }
}

/** 
  This function is used to set the isNotifClosed flag to true for the user.
  It takes the user address and the chain id as input.
  It sets the isNotifClosed flag to true for the user in the local storage.
  * @param {string} chainId - The chain ID of the user.
  * @param {string} account - The account of the user.
*/
export function setIsNotifClosedForuser(userAddress: string, chainId: ChainId) {
  const { referralInfoLocal, userReferralInfoLocal } = getReferralInfoFromLocalStorageForUser(chainId, userAddress)
  if (userReferralInfoLocal) {
    const newInfo = {
      ...userReferralInfoLocal,
      isNotifClosed: true,
    }

    const newLocalStorageData = {
      ...referralInfoLocal,
      [chainId]: {
        ...referralInfoLocal[chainId],
        [userAddress]: newInfo,
      },
    }
    setReferralDataToLocalStore(JSON.stringify(newLocalStorageData), chainId)
  }
}

/**
 *  This function is used to check if the address is a lowercase hex address.
 * @param address
 * @returns
 */
function isLowercaseHexAddress(address: string, starkvalidAddress: string) {
  return starkvalidAddress.length && address.length && /^0x[0-9a-f]+$/.test(address)
}
