import { ApiPromise } from '@polkadot/api';
import { useMemo } from 'react';
import { useApi } from '../api/Api';

export interface ChainInfo {
    tokenDecimals: number;
}

const DEFAULT_DECIMALS = 15;

function createInfo(api: ApiPromise): ChainInfo {
    const tokenDecimals = api.registry.chainDecimals || DEFAULT_DECIMALS;

    return {
        tokenDecimals: tokenDecimals[0],
    };
}

export default function useChainInfo(): ChainInfo {
    const { api, isReady } = useApi();

    // eslint-disable-next-line
    return useMemo(() => createInfo(api), [api, isReady]);
}
