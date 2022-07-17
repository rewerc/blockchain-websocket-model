import { Transaction, Blockchain } from "./blockchain.js";
import elliptic from "elliptic";
const EC = elliptic.ec; 
const ec = new EC("secp256k1");

function addTransaction(privateKey, publicKey, amount, data, chain) {
    const tx = new Transaction(ec.keyFromPrivate(privateKey).getPublic("hex"), publicKey, amount, data, chain.getNonce());
    chain.addTransaction(tx);
    return tx;
}

function createWalletAddress() {
    let keygen = new EC("secp256k1").genKeyPair();
    return [keygen.getPrivate("hex"), keygen.getPublic("hex")];
}

function toError(string) {
    return JSON.stringify({
        type: "error",
        message: string
    });
}

function isJSON(string) {
    try {
        JSON.parse(string);
    } catch (e) {
        return false;
    }
    return true;
}

export { addTransaction, createWalletAddress, toError, isJSON };