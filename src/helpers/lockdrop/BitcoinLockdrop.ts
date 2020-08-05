/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Message } from 'bitcore-lib';
import * as bitcoinjs from 'bitcoinjs-lib';
import bip68 from 'bip68';
import { LockdropType, HwSigner } from '../../types/LockdropModels';
import { Network } from 'bitcoinjs-lib';
import { BlockCypherApi } from '../../types/BlockCypherTypes';
import BigNumber from 'bignumber.js';
import * as plasmUtils from '../plasmUtils';
import { BlockStreamApi } from 'src/types/BlockStreamTypes';
import { SoChainApi } from 'src/types/SoChainTypes';
import AppBtc from '@ledgerhq/hw-app-btc';

// https://www.blockchain.com/api/api_websocket
export const BLOCKCHAIN_WS = 'wss://ws.blockchain.info/inv';

/**
 * the message that will be hashed and signed by the client
 */
export const MESSAGE = 'plasm network btc lock'; //todo: add nonce for security

/**
 * returns a blob url for the qr encoded bitcoin address
 * @param btcAddress bitcoin address
 */
export async function qrEncodeUri(btcAddress: string, size = 300) {
    const qrCode = URL.createObjectURL(
        await fetch(`https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${btcAddress}`).then(res =>
            res.blob(),
        ),
    );

    return qrCode;
}

/**
 * Returns a list of transactions from the given address.
 * This data is fetched from BlockStream
 * @param address BTC address to look for
 * @param network BTC network token (mainnet or testnet)
 */
export async function getBtcTxsFromAddress(address: string, network: 'mainnet' | 'testnet') {
    const api = `https://blockstream.info/${network === 'mainnet' ? '' : 'testnet/'}api/address/${address}/txs`;
    const res = await (await fetch(api)).text();
    if (res.includes('Invalid Bitcoin address')) {
        throw new Error('Invalid Bitcoin address');
    }

    const txs: BlockStreamApi.Transaction[] = JSON.parse(res);
    return txs;
}

/**
 * Returns the transaction information from the given transaction hash/TXID.
 * This data is fetched from BlockStream
 * @param txid transaction hash or TXID in hex string
 * @param network BTC network token (mainnet or testnet)
 */
export async function getBtcTxFromTxId(txid: string, network: 'mainnet' | 'testnet') {
    const api = `https://blockstream.info/${network === 'mainnet' ? '' : 'testnet/'}api/tx/${txid.replace('0x', '')}`;
    const res = await (await fetch(api)).text();
    if (res.includes('Invalid hex string')) {
        throw new Error('Invalid hex string');
    }

    const tx: BlockStreamApi.Transaction = JSON.parse(res);
    return tx;
}

/**
 * returns the detailed information of the given address via blockcypher API calls.
 * such information includes transaction references, account balances, and more
 * @param address bitcoin address
 * @param network network type
 * @param limit filters the number of transaction references
 */
export async function getAddressEndpoint(
    address: string,
    network: 'main' | 'test3',
    limit = 50,
    unspentOnly?: boolean,
    includeScript?: boolean,
) {
    const api = `https://api.blockcypher.com/v1/btc/${network}/addrs/${address}/full?unspentOnly=${unspentOnly}&includeScript=${includeScript}?limit=${limit}`;

    const res = await (await fetch(api)).text();

    if (res.includes('error')) {
        throw new Error(res);
    }

    const addressEndpoint: BlockCypherApi.BtcAddress = JSON.parse(res);
    return addressEndpoint;
}

/**
 * returns the detailed information of the given transaction hash via blockcypher API calls.
 * such information includes transaction input, output, addresses, and more
 * @param txHash bitcoin transaction hash
 * @param network network type
 * @param limit filters the number of TX inputs and outputs
 */
export async function getTransactionEndpoint(txHash: string, network: 'main' | 'test3', limit = 20) {
    const api = `https://api.blockcypher.com/v1/btc/${network}/txs/${txHash}?limit=${limit}`;

    const res = await (await fetch(api)).text();

    if (res.includes('error')) {
        throw new Error(res);
    }

    const hashEndpoint: BlockCypherApi.BtcTxHash = JSON.parse(res);
    return hashEndpoint;
}

/**
 * returns a high-level information about the given address such as total received, spent, final bal, etc.
 * @param addr bitcoin address to look for
 * @param network network type
 */
export async function getAddressBalance(addr: string, network: 'main' | 'test3') {
    const api = `https://api.blockcypher.com/v1/btc/${network}/addrs/${addr}/balance`;

    const res = await (await fetch(api)).text();

    if (res.includes('error')) {
        throw new Error(res);
    }

    const addressInfo: BlockCypherApi.AddressBalance = JSON.parse(res);
    return addressInfo;
}

/**
 * returns a raw transaction in hex strings from SoChain REST API.
 * @param txId transaction ID or transaction hash
 * @param network BTC network to choose from
 */
export async function getTransactionHex(txId: string, network: 'BTC' | 'BTCTEST') {
    const api = `https://sochain.com/api/v2/get_tx/${network}/${txId}`;

    const res = await (await fetch(api)).text();

    if (res.includes('fail')) {
        throw new Error(res);
    }

    const txHex: SoChainApi.Transaction = JSON.parse(res);
    return txHex.data.tx_hex;
}

/**
 * Validates the given BTC address by checking if it's in the correct format.
 * The default network is set to mainnet, byt anything else will require you to explicitly
 * pass it as the parameter.
 * @param address Bitcoin public address
 * @param network bitcoin network type (bitcoinjs-lib)
 */
export function validateBtcAddress(address: string, network?: bitcoinjs.networks.Network) {
    try {
        bitcoinjs.address.toOutputScript(address, network);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Validates the given public key hex by importing it through bitcoinjs ECPair.
 * Returns true if it's valid, and false if it's invalid
 * @param publicKey Bitcoin public key hex string
 * @param network bitcoin network to check from. Defaults to mainnet
 */
export function validatePublicKey(publicKey: string, network?: bitcoinjs.networks.Network) {
    try {
        bitcoinjs.ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), { network: network });

        const { address } = bitcoinjs.payments.p2pkh({ pubkey: Buffer.from(publicKey, 'hex'), network: network });
        if (typeof address === 'string' && !validateBtcAddress(address, network)) {
            throw new Error('Invalid public key');
        }

        return true;
    } catch (e) {
        return false;
    }
}

/**
 * returns the network type that the given address belongs to.
 * this will also validate the address before returning a value.
 * @param address bitcoin address
 */
export function getNetworkFromAddress(address: string) {
    // sources: https://en.bitcoin.it/wiki/List_of_address_prefixes
    // main net public key hash prefixes
    const mainNetPref = ['1', '3', 'bc1'];
    // test net public key hash prefixes
    const testNetPref = ['m', 'n', 'tb1', '2'];
    let addressNetwork: bitcoinjs.networks.Network;

    if (new RegExp(`^(${mainNetPref.join('|')})`).test(address)) {
        // check for regex match from the given address and array
        addressNetwork = bitcoinjs.networks.bitcoin;
        //return bitcoinjs.networks.bitcoin;
    } else if (new RegExp(`^(${testNetPref.join('|')})`).test(address)) {
        addressNetwork = bitcoinjs.networks.testnet;
        //return bitcoinjs.networks.testnet;
    } else {
        throw new Error('Invalid Bitcoin address');
    }

    if (!validateBtcAddress(address, addressNetwork)) {
        throw new Error('Invalid Bitcoin address');
    }
    return addressNetwork;
}

/**
 * converts satoshi to bitcoin
 * @param satoshi number of satoshi
 */
export function satoshiToBitcoin(satoshi: BigNumber | number | string) {
    // 1 bitcoin = 100,000,000 satoshi

    const denominator = new BigNumber(10).pow(new BigNumber(8));

    // if the parameter is a number, convert it to BN
    if (typeof satoshi === 'number' || typeof satoshi == 'string') {
        return new BigNumber(satoshi).div(denominator);
    }
    return satoshi.div(denominator);
}

/**
 * converts bitcoin into satoshi
 * @param bitcoin number of bitcoin
 */
export function bitcoinToSatoshi(bitcoin: BigNumber | number | string) {
    // 1 bitcoin = 100,000,000 satoshis
    const denominator = new BigNumber('100000000');

    if (typeof bitcoin === 'number' || typeof bitcoin == 'string') {
        return new BigNumber(bitcoin).multipliedBy(denominator);
    }
    return bitcoin.multipliedBy(denominator);
}

/**
 * converts an compressed public key to a uncompressed public key
 * @param publicKey compressed BTC public key
 */
export function decompressPubKey(publicKey: string, network: bitcoinjs.Network) {
    const pubKeyPair = bitcoinjs.ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), {
        compressed: false,
        network: network,
    });
    return pubKeyPair.publicKey.toString('hex');
}

/**
 * compresses the given BTC public key
 * @param publicKey uncompressed BTC public key
 * @param network bitcoin network the public key will encode for
 */
export function compressPubKey(publicKey: string, network: bitcoinjs.Network) {
    const pubKeyPair = bitcoinjs.ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), {
        compressed: true,
        network: network,
    });
    return pubKeyPair.publicKey.toString('hex');
}

/**
 * returns a public key from the given address and signature
 * by default this will return an uncompressed public key.
 * this function will only work with BIP44 encoded address. BIP49 or BIP84 will return
 * an error.
 * @param address bitcoin address
 * @param signature base 64 signature for signing the plasm network message
 * @param compression should the public key be compressed or not
 * @param msg optional message used to generate the signature
 */
export function getPublicKey(
    address: string,
    signature: string,
    compression?: 'compressed' | 'uncompressed',
    msg?: string,
) {
    const compressedPubKey = new Message(msg ? msg : MESSAGE).recoverPublicKey(
        address,
        signature.replace(/(\r\n|\n|\r)/gm, ''),
    );
    const addressNetwork = getNetworkFromAddress(address);
    return compression === 'compressed' ? compressedPubKey : decompressPubKey(compressedPubKey, addressNetwork);
}

/**
 * used for CHECKSEQUENCEVERIFY relative time lock.
 * this converts days to bip68 encoded block number.
 * @param days number of days to be converted to sequence number
 */
export function daysToBlockSequence(days: number) {
    // verify lock days value
    if (!Number.isInteger(days) || !Number.isFinite(days)) {
        throw new Error('Lock days must be a valid integer, but received: ' + days);
    }
    const blocksPerDay = 144; //10 min per block. day = 6 * 24
    const blockSequence = bip68.encode({ blocks: days * blocksPerDay });
    if (blockSequence > 65535) {
        // maximum lock time https://en.bitcoin.it/wiki/Timelock
        throw new Error('Block sequence cannot be more than 65535');
    }
    return blockSequence;
}

/**
 * create a bitcoin lock script buffer with the given public key.
 * this will lock the token for the given number of block sequence.
 * if the given public key is not compressed, this function will compress it.
 * @param publicKeyHex compressed BTC public key in hex string
 * @param blockSequence bip68 encoded block sequence
 * @param network bitcoin network the public key belongs to
 */
export function btcLockScript(publicKeyHex: string, blockSequence: number, network: bitcoinjs.Network): Buffer {
    // verify block sequence value
    if (blockSequence < 0) {
        throw new Error('Block sequence cannot be a negative number');
    }
    if (!Number.isInteger(blockSequence) || !Number.isFinite(blockSequence)) {
        throw new Error('Block sequence must be a valid integer, but received: ' + blockSequence);
    }
    if (blockSequence > 65535) {
        // maximum lock time https://en.bitcoin.it/wiki/Timelock
        throw new Error('Block sequence cannot be more than 65535');
    }
    // verify public key by converting to an address
    if (!validatePublicKey(publicKeyHex, network)) {
        throw new Error('Invalid public key');
    }

    const pubKeyBuffer = Buffer.from(compressPubKey(publicKeyHex, network), 'hex');

    return bitcoinjs.script.fromASM(
        `
        ${bitcoinjs.script.number.encode(blockSequence).toString('hex')}
        OP_CHECKSEQUENCEVERIFY
        OP_DROP
        ${pubKeyBuffer.toString('hex')}
        OP_CHECKSIG
        `
            .trim()
            .replace(/\s+/g, ' '),
    );
}

/**
 * creates a P2SH instance that locks the sent token for the given duration.
 * the locked tokens can only be claimed by the provided public key
 * @param lockDays the lock duration in days
 * @param publicKey public key of the locker. This can be both compressed or uncompressed
 * @param network bitcoin network the script will generate for
 */
export function getLockP2SH(lockDays: number, publicKey: string, network: bitcoinjs.Network) {
    // only check lock duration boundaries for main net
    if (network === bitcoinjs.networks.bitcoin) {
        if (lockDays > 300 || lockDays < 30) {
            throw new Error('Lock duration must be between 30 days to 300 days');
        }
    }

    return bitcoinjs.payments.p2sh({
        network: network,
        redeem: {
            output: btcLockScript(publicKey, daysToBlockSequence(lockDays), network),
        },
    });
}

/**
 * creates a lock redeem UTXO
 * @param signer the signer for signing the transaction hash
 * @param network network type (bitcoinjs-lib)
 * @param lockTx the transaction that locks the value to P2SH address
 * @param lockScript the lock script (P2SH)
 * @param blockSequence block sequence to lock the funds, should be the same value used in the lock script
 * @param recipient recipient for the transaction output
 * @param fee transaction fee for the lock transaction
 */
export async function btcUnlockTx(
    signer: HwSigner,
    network: Network,
    lockTx: bitcoinjs.Transaction,
    lockScript: Buffer,
    blockSequence: number,
    recipientAddress: string,
    fee: number, // satoshis
) {
    function idToHash(txid: string): Buffer {
        return Buffer.from(txid, 'hex').reverse();
    }
    function toOutputScript(address: string): Buffer {
        return bitcoinjs.address.toOutputScript(address, network);
    }

    if (blockSequence < 0) {
        throw new Error('Block sequence cannot be less than zeo');
    }
    if (fee < 0) {
        throw new Error('Transaction fee cannot be less than zero');
    }

    if (!Number.isInteger(blockSequence) || !Number.isFinite(blockSequence)) {
        throw new Error('Block sequence must be a valid integer, but received: ' + blockSequence);
    }
    if (!Number.isInteger(fee) || !Number.isFinite(fee)) {
        throw new Error('Fee must be a valid integer, but received: ' + fee);
    }

    const txIndex = 0;

    //const sequence = bip68.encode({ blocks: lockBlocks });
    const tx = new bitcoinjs.Transaction();
    tx.version = 2;
    tx.addInput(idToHash(lockTx.getId()), txIndex, blockSequence);
    tx.addOutput(toOutputScript(recipientAddress), lockTx.outs[txIndex].value - fee);

    const hashType = bitcoinjs.Transaction.SIGHASH_ALL;
    const signatureHash = tx.hashForSignature(0, lockScript, hashType);
    const signature = bitcoinjs.script.signature.encode(await signer.sign(signatureHash), hashType);

    const redeemScriptSig = bitcoinjs.payments.p2sh({
        network,
        redeem: {
            network,
            output: lockScript,
            input: bitcoinjs.script.compile([signature]),
        },
    }).input;
    if (redeemScriptSig instanceof Buffer) {
        tx.setInputScript(0, redeemScriptSig);
    } else {
        throw new Error('Transaction is invalid');
    }

    return tx;
}

/**
 * creates a lockdrop parameter from the given lock script address and values
 * by fetching all transactions in the lock script address from block stream
 * @param scriptAddress the P2SH lock address
 * @param lockDuration duration of the lock in days
 * @param publicKey compressed BTC public key of the locker
 * @param network bitcoin network
 */
export async function getLockParameter(
    scriptAddress: string,
    lockDurationDays: number,
    publicKey: string,
    network: 'mainnet' | 'testnet',
) {
    const btcNetwork = network === 'mainnet' ? bitcoinjs.networks.bitcoin : bitcoinjs.networks.testnet;
    const p2sh = bitcoinjs.payments.p2sh({
        network: btcNetwork,
        redeem: {
            output: btcLockScript(publicKey, daysToBlockSequence(lockDurationDays), btcNetwork),
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (p2sh.address && p2sh.address !== scriptAddress) {
        throw new Error('Lock script information does not match P2SH');
    }

    if (!validatePublicKey(publicKey, btcNetwork)) {
        throw new Error('Invalid Public Key');
    }

    if (lockDurationDays < 0 || !Number.isInteger(lockDurationDays)) {
        throw new Error('Invalid lock duration');
    }

    const locks = await getBtcTxsFromAddress(scriptAddress, network);
    const daysToEpoch = 60 * 60 * 24 * lockDurationDays;

    const lockParams = locks.map(i => {
        const lockVal = i.vout.find(locked => locked.scriptpubkey_address === scriptAddress);

        if (typeof lockVal === 'undefined') {
            throw new Error('Cannot find lock transaction for ' + scriptAddress);
        }

        return plasmUtils.createLockParam(
            LockdropType.Bitcoin,
            '0x' + i.txid,
            '0x' + publicKey,
            daysToEpoch.toString(),
            lockVal.value.toString(),
        );
    });

    return lockParams;
}

export const generateSigner = async (
    ledgerApi: AppBtc,
    path: string,
    network: bitcoinjs.Network,
    lockTxHex: string,
    lockScript: bitcoinjs.payments.Payment,
    publicKey: string,
) => {
    const ledgerTx = ledgerApi.splitTransaction(lockTxHex);
    //console.log(ledgerTx.outputs![1].script.toString('hex'));
    //const SIGHASH_ALL = 1; //temp value
    const txIndex = 0; //temp value
    const isSegWig = bitcoinjs.Transaction.fromHex(lockTxHex).hasWitnesses();
    return {
        network: network,
        publicKey: Buffer.from(publicKey, 'hex'),

        sign: async (hash: Buffer, lowR?: boolean) => {
            console.log('signing with ledger');
            const ledgerTxSignatures = await ledgerApi.signP2SHTransaction({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                inputs: [[ledgerTx, txIndex, lockScript.redeem!.output!.toString('hex'), null]],
                associatedKeysets: [path],
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                outputScriptHex: lockScript.output!.toString('hex'),
                segwit: isSegWig,
                transactionVersion: 2,
                //sigHashType: SIGHASH_ALL,
            });
            console.log({ ledgerTxSignatures });
            console.log(hash.toString('hex') + lowR);
            const [ledgerSignature] = ledgerTxSignatures;
            const encodedSignature = (() => {
                if (isSegWig) {
                    return Buffer.from(ledgerSignature, 'hex');
                }
                return Buffer.concat([
                    Buffer.from(ledgerSignature, 'hex'),
                    Buffer.from('01', 'hex'), // SIGHASH_ALL
                ]);
            })();
            const decoded = bitcoinjs.script.signature.decode(encodedSignature);
            return decoded.signature;
        },
    };
};
