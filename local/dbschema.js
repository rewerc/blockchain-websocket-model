import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema({
    data: String
});

const Asset = mongoose.model("asset", assetSchema);

const Wallet = mongoose.model("wallet", new mongoose.Schema({
    privateKey: String,
    publicKey: String
}));
const dataSchema = new mongoose.Schema({
    hash: String,
    path: String,
    org: String,
    misc: Object,
});
const Data = mongoose.model("data", dataSchema);    
const transactionSchema = new mongoose.Schema({
    fromAddress: String,
    toAddress: String,
    hash: String,
    amount: Number,
    timestamp: String,
    witness: [String],
    data: dataSchema
});
const Transactions = mongoose.model("transaction", transactionSchema);
const Blocks = mongoose.model("block", new mongoose.Schema({
    _id: Number,
    hash: String,
    previousHash: String,
    timestamp: String,
    nonce: String,
    transaction: transactionSchema
}));
const Pendings = mongoose.model("pending", transactionSchema);
const Contract = mongoose.model("contract", new mongoose.Schema({
    address: String,
    nonce: Number,
}));

export { Wallet, Transactions, Blocks, Pendings, Data, Contract, Asset };