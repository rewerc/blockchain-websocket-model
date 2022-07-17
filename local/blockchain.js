import crypto from "crypto";
import elliptic from "elliptic";

const EC = elliptic.ec; 
const ec = new EC("secp256k1");

class Block {
    constructor(id, timestamp, transaction, nonce, previousHash = "") {
        this._id = id;
        this.previousHash = previousHash;
        this.timestamp = timestamp;
        this.transaction = transaction;
        this.nonce = nonce;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        return crypto.createHash("sha256").update(this.previousHash + this.timestamp + JSON.stringify(this.transaction) + this.nonce).digest("hex");
    }
}

class Blockchain {
    constructor() {
        this.chain = [];
        this.pendingTransactions = [];
        this.nonce = 0;
    }

    getNonce() {
        return (this.nonce++).toString();
    }

    createGenesisBlock() {
         this.chain.push(new Block(1, new Date().toString(), {}, this.getNonce(), "0"));
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    getLatestPending() {
        return this.pendingTransactions[this.pendingTransactions.length - 1];
    }

    recordTransaction(transaction) {
        const block = new Block(this.chain.length + 1, new Date().toString(), transaction, this.getNonce(), this.getLatestBlock().hash);
        if (this.chain.some(blk => blk.hash === block.hash || blk._id.toString() === block._id.toString())) return false;
        console.log(`New block: ${block.hash}`);
        this.chain.push(block);
        console.log("Block added to the chain");
        return block.hash;
    }

    addTransaction(transaction) {
        this.pendingTransactions.push(transaction);
        console.log(`Transaction added: ${transaction.hash}`)
    }

    getBalanceOfAddress(address) {
        let balance = 100;
        for (const block of this.chain) {
            if (block._id === 1) continue;
            const trans = block.transaction;
            if (trans.fromAddress === address) {
                balance -= parseFloat(trans.amount);
            }
            if (trans.toAddress === address) {
                balance += parseFloat(trans.amount);
            }
        }
        for (const trans of this.pendingTransactions) {
            if (trans.fromAddress === address) {
                balance -= parseFloat(trans.amount);
            }
        }
        console.log(`Get balance of address: ${balance}`);
        return balance;
    }
}

class Transaction {
    constructor(fromAddress, toAddress, amount, data, nonce) {
        this.fromAddress = fromAddress;
        this.toAddress = toAddress;
        this.amount = amount;
        this.timestamp = new Date().toString();
        this.witness = [];
        if (data) {
            this.data = data;
        } else {
            this.data = {};
        }
        this.hash = this.calculateHash(nonce);
    }

    calculateHash(nonce) {
        return crypto.createHash("sha256").update(this.fromAddress + this.toAddress + this.amount + this.timestamp + JSON.stringify(this.data)).digest("hex") + nonce.toString();
    }
}

function createContract(privateKey, publicKey, nonce) {
    return crypto.createHash("sha256").update(privateKey + publicKey + nonce).digest("hex");
}

export { Blockchain, Transaction, Block, createContract };
