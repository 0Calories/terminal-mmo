import { computeContractHash } from '@mmo/assets';

declare const MMO_CONTRACT_HASH: string;

export const CLIENT_CONTRACT_HASH =
	typeof MMO_CONTRACT_HASH !== 'undefined'
		? MMO_CONTRACT_HASH
		: computeContractHash();
