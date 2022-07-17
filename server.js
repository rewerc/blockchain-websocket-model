import express from "express";
import http from "http";
import mongoose from "mongoose";
import session from "express-session";
import { WebSocket, WebSocketServer } from "ws";
import { Blockchain, createContract } from "./local/blockchain.js";
import { isJSON, addTransaction, createWalletAddress, toError } from "./local/misc.js";
import { Wallet, Transactions, Blocks, Pendings, Contract, Asset } from "./local/dbschema.js";
import elliptic from "elliptic";
import multer from "multer";
import crypto from "crypto";
import cors from "cors";
import "dotenv/config";
const EC = elliptic.ec; 
const ec = new EC("secp256k1");

const app = express();
const server  = http.createServer(app);

app.set('view engine', 'ejs');
app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "blockchain",
    resave: false,
    saveUninitialized: false
}));

const uri = process.env.MONGO_URI;
mongoose.connect(uri, { useNewUrlParser: true })
    .then(() => console.log("Database connected!"))
    .catch(err => console.log(err));

const BC = new Blockchain();

Blocks.find({}, {}, (err, blockchain) => {
    if (err) console.log(err);
    if (blockchain[0]) { 
        BC.chain = blockchain;
    }
    else {
        BC.createGenesisBlock();
        let genesis = new Blocks({
            _id: 1,
            hash: BC.chain[0].hash,
            previousHash: BC.chain[0].previousHash,
            timestamp: BC.chain[0].timestamp,
            nonce: BC.chain[0].nonce
        });
        console.log(genesis);
        genesis.save();
    }
});

(async() => {
    BC.chain = await Blocks.find({}, {});
    BC.pendingTransactions = await Pendings.find({}, {});
})();
    
const wss = new WebSocketServer({ server: server, path: "/client" });
wss.on("connection", async function (ws) {
    console.log("A new client connected");

    ws.isAlive = true;
    if (wss.clients.size === 1) {
        wss.interval = setInterval(() => {
            wss.clients.forEach(client => {
                if (client.isAlive === false) {
                    client.terminate();
                    console.log("Disconnected client");
                }
                client.isAlive = false;
                client.ping();
            });
        }, 25000);
    } 
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: "online-peers",
                onlinePeers: wss.clients.size
            }));
        }
    });

    ws.on("close", function() {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "online-peers",
                    onlinePeers: wss.clients.size
                }));
            }
        });
        if (wss.clients.size < 1) {
            clearInterval(wss.interval);
            console.log("Interval Cleared");
        }
    });

    ws.on("message", async function (message) {
        const data = JSON.parse(message);

        if (data.type === "get-blocks") {
            const num = parseInt(data.message.number);
            if (BC.getLatestBlock()._id < num) {
                ws.send(JSON.stringify({
                    type: "blocks",
                    message: {
                        blocks: BC.chain,
                        pendingTransactions: BC.pendingTransactions,
                        reset: true
                    }
                }));
            } else {
                ws.send(JSON.stringify({
                    type: "blocks",
                    message: {
                        blocks: BC.chain.filter(blk => blk._id > num),
                        pendingTransactions: BC.pendingTransactions,
                        reset: false
                    }
                }));
            }
        }

        if (data.type === "witness") {
            const witness = data.message.witness;
            const hash = data.message.hash;
            let found = (BC.pendingTransactions.filter(tx => tx.hash === hash))[0];
            console.log(found);
            if (!found) {
                ws.send(toError("Pending transaction has expired"));
                return;
            }

            if (found.witness.includes(witness)) {
                ws.send(toError("You have witnessed this transaction"));
                return;
            }

            await Pendings.updateOne({
                hash: found.hash
            }, {witness: found.witness});
            
            for (let i = 0; i < BC.pendingTransactions.length; i++) {
                if (BC.pendingTransactions[i].hash === found.hash) {
                    BC.pendingTransactions[i].witness.push(witness);
                    break;
                }
            }
            
            found = (BC.pendingTransactions.filter(tx => tx.hash === hash))[0];
            console.log(found);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "update-witness",
                        message: {
                            hash: found.hash,
                            witness: found.witness
                        }
                    }));
                }
            });
            if (found.witness.length > 1) {
                const movedData = (BC.pendingTransactions.filter(tx => tx.hash === found.hash))[0];
                const newBlockHash = BC.recordTransaction(movedData);
                if (!newBlockHash) ws.send(toError("Block already created."));
                await Pendings.deleteOne({ hash: found.hash });
                BC.pendingTransactions = BC.pendingTransactions.filter(tx => tx.hash !== found.hash);
                const block = (BC.chain.filter(blk => blk.hash === newBlockHash))[0];
                const newBlock = new Blocks({
                    _id: block._id,
                    hash: block.hash,
                    previousHash: block.previousHash,
                    timestamp: block.timestamp,
                    nonce: block.nonce,
                    transaction: {
                        fromAddress: movedData.fromAddress,
                        toAddress: movedData.toAddress,
                        hash: movedData.hash,
                        amount: movedData.amount,
                        timestamp: movedData.timestamp,
                        witness: movedData.witness,
                        data: movedData.data
                    }
                });
                await newBlock.save();

                wss.clients.forEach(function (client) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "created-block",
                            message: {
                                block: BC.getLatestBlock(),
                                hash: found.hash
                            } 
                        }));
                    }
                });
            }
        }

        if (data.type === "transaction") {
            const fromAddr = data.message.fromAddress;
            const toAddr = data.message.toAddress;
            const amount = data.message.amount;
            const privateKey = data.message.privateKey;
            const transactionData = isJSON(data.message.data) ? JSON.parse(data.message.data) : data.message.data;
            if (data.message.hashData) {
                transactionData.hash = crypto.createHash("sha256").update(data.message.data).digest("hex");
                ws.send(JSON.stringify({
                    type: "data-hash",
                    message: {
                        hash: transactionData.hash
                    }
                }));
            } 

            if (parseFloat(amount) <= 0) {
                console.log("You can only send more than 0 amount");
                ws.send(toError("You can only send more than 0 amount"));
                return;
            }
        
            if (fromAddr === toAddr) {
                console.log("Can't send to yourself");
                ws.send(toError("Can't send to yourself"));
                return;
            }
        
            if (fromAddr !== (ec.keyFromPrivate(privateKey)).getPublic("hex")) {
                console.log("Private key didn't match");
                ws.send(toError("Private key didn't match"));
                return;
            }
            
            const keys = await Wallet.find({ $or: [
                {publicKey: fromAddr}, 
                {publicKey: toAddr}
            ]}, {_id: 0});
            if (keys.length === 1) {
                if (keys[0].publicKey === fromAddr) {
                    const contract = await Contract.findOne({ address: toAddr });
                    if (!contract) {
                        ws.send("Receiving party not found");
                        return;
                    }
                } else if (keys[0].publicKey === toAddr) {
                    const contract = await Contract.findOne({ address: fromAddr });
                    if (!contract) {
                        ws.send("Sending party not found");
                        return;
                    }
                }
            } else if (keys.length !== 2) {
                console.log("Transaction party(s) unidentified");
                ws.send(toError("Transaction party(s) unidentified"));
                return;
            }
            
            if (BC.getBalanceOfAddress(fromAddr) < amount) {
                console.log("Not enough balance");
                ws.send(toError("Not enough balance"));
                return;
            }
            const newTransaction = addTransaction(privateKey, toAddr, amount, transactionData, BC);
            
            const newPending = new Pendings({
                fromAddress: newTransaction.fromAddress,
                toAddress: newTransaction.toAddress,
                hash: newTransaction.hash,
                amount: newTransaction.amount,
                timestamp: newTransaction.timestamp,
                witness: [],
                data: newTransaction.data
            });
            await newPending.save();
        
            wss.clients.forEach(function (client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "latest-pending",
                        message: newTransaction
                    }));
                }
            });
        }
    });
});

app.get("/", async (req, res) => {
    let pubAddr = req.session.publicKey;
    if (pubAddr) res.render("index", {
        publicKey: pubAddr
    });
    else res.redirect("/login");
});

app.get("/create-wallet", (req, res) => {
    res.render("create-wallet");
});

app.post("/create-wallet", (req, res) => {
    const newWallet = createWalletAddress();
    const wallet = new Wallet({
        privateKey: newWallet[0],
        publicKey: newWallet[1]
    });
    wallet.save();
    res.send(JSON.stringify(newWallet));
});

app.get("/login", (req, res) => {
    res.render("login", {
        error: 0
    });
});

app.post("/login", (req, res) => {
    let addr = req.body.address;

    Wallet.findOne({privateKey: addr}, (err, wallet) => {
        if (err) console.log(err);
        if (wallet) {
            req.session.privateKey = wallet.privateKey;
            req.session.publicKey = wallet.publicKey;
            res.redirect("/");
        } else {
            res.render("login", {
                error: 1
            });
        }
    });
});

app.post("/confirm-wallet", multer().none(), cors(), (req, res) => {
    const addr = req.body.private;

    Wallet.findOne({privateKey: addr}, (err, wallet) => {
        if (err) console.log(err);
        if (wallet) {
            res.send({ 
                publicKey: wallet.publicKey, 
                privateKey: wallet.privateKey 
            });
        } else {
            res.send(false);
        }
    });
});

app.get("/create-contract", (req, res) => {
    res.render("contract", {
        error: 0,
        contract: false
    });
});

app.post("/create-contract", multer().none(), cors(), async (req, res) => {
    const publicKey = req.body.public;
    const privateKey = req.body.private;

    if (publicKey !== (ec.keyFromPrivate(privateKey)).getPublic("hex")) {
        res.render("contract", {
            error: 1,
            contract: false
        });
        return;
    }

    const found = await Wallet.findOne({privateKey: privateKey, publicKey: publicKey});

    if (found) {
        const nonce = BC.getNonce();
        const contractAddr = createContract(privateKey, publicKey, nonce);

        const trans = addTransaction(privateKey, contractAddr, 1, null, BC);
        const newPending = new Pendings({
            fromAddress: trans.fromAddress,
            toAddress: trans.toAddress,
            hash: trans.hash,
            amount: trans.amount,
            timestamp: trans.timestamp,
            signature: trans.signature,
            witness: [],
            data: trans.data
        });
        await newPending.save();
        const newContract = new Contract({
            address: contractAddr,
            nonce: nonce,
        });
        await newContract.save();

        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "latest-pending",
                    message: trans
                }));
            }
        }
        
        res.render("contract", {
            error: 0,
            contract: contractAddr
        });
    } else {
        res.render("contract", {
            error: 1,
            contract: false
        });
    }
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server running");
});

