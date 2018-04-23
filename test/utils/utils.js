// taken/borrowed from ROSCA/WeTrust https://github.com/WeTrustPlatform/rosca-contracts/blob/b72ee795d2a73b5fda76b7015720b6ea5f8c8804/test/utils/utils.js
// thanks!
let Web3 = require('web3')
let web3 = new Web3(
    new Web3.providers.HttpProvider(
        'http://' +
            (process.env.NODE_ENV === 'docker' ? 'ganache-cli' : 'localhost') +
            ':8545'
    )
)
const BigNumber = require('bignumber.js')

let assert = require('chai').assert
const MAX_GAS_COST_PER_TX = 1e5 /* gas used per tx */ * 2e10
const ERROR_VM_EXCEPTION_REVERT =
    'VM Exception while processing transaction: revert'
/* gas price */

// we need this because test env is different than script env
let myWeb3 = typeof web3 === undefined ? undefined : web3

module.exports = {
    crowdsaleState: {
        PREFUNDING: 0,
        FUNDING: 1,
        SUCCESS: 2,
        FAILURE: 3
    },
    numBlocksLocked: 12,
    gasEpsilon: 10000,
    startBlockMainNet: 3445888,
    endBlockMainNet: 3618688,
    multisigWalletAddressMainNet: '0x0',
    getWeb3: function() {
        return myWeb3
    },
    afterFee: function(amount, serviceFeeInThousandths) {
        return amount / 1000 * (1000 - serviceFeeInThousandths)
    },
    assertEqualUpToGasCosts: function(actual, expected) {
        assert.closeTo(actual, expected, MAX_GAS_COST_PER_TX)
    },
    assertThrows: function(promise, err) {
        return promise
            .then(function() {
                assert.isNotOk(true, err)
            })
            .catch(function(e) {
                assert.include(
                    e.message,
                    'invalid JUMP',
                    "Invalid Jump error didn't occur"
                )
            })
    },
    assertFail: async function(promise) {
        try {
            await promise
        } catch (error) {
            // TODO: Check jump destination to destinguish between a throw
            //       and an actual invalid jump.
            const invalidJump = error.message.search('invalid JUMP') >= 0
            // TODO: When we contract A calls contract B, and B throws, instead
            //       of an 'invalid jump', we get an 'out of gas' error. How do
            //       we distinguish this from an actual out of gas event? (The
            //       testrpc log actually show an 'invalid jump' event.)
            const outOfGas = error.message.search('out of gas') >= 0
            const revert = error.message.search(ERROR_VM_EXCEPTION_REVERT) >= 0
            assert(
                invalidJump || outOfGas || revert,
                "Expected throw, got '" + error + "' instead"
            )
            return
        }
        assert.fail('Expected throw not received')
    },
    getFunctionSelector: function(functionSignature) {
        // no spaces
        functionSignature = functionSignature.replace(/ /g, '')
        // no uints, only uint256s
        functionSignature = functionSignature.replace(/uint,/g, 'uint256,')
        functionSignature = functionSignature.replace(/uint\)/g, 'uint256)')
        return myWeb3.utils.sha3(functionSignature).slice(0, 10)
    },
    // TODO: make this more robust, can args be a single entity, not an array, replace spaces in signature,...
    getFunctionEncoding: function(functionSignature, args) {
        selector = this.getFunctionSelector(functionSignature)
        argString = ''
        for (let i = 0; i < args.length; i++) {
            paddedArg = myWeb3.utils.toHex(args[i]).slice(2)
            while (paddedArg.length % 64 != 0) {
                paddedArg = '0' + paddedArg
            }
            argString = argString + paddedArg
        }
        return selector + argString
    },
    getGasUsage: function(contract, networkId) {
        return new Promise(function(resolve, reject) {
            myWeb3.eth
                .getTransactionReceipt(
                    contract.networks[networkId].transactionHash
                )
                .then(function(receipt) {
                    resolve({
                        transactionHash: receipt.transactionHash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed,
                        cumulativeGasUsed: receipt.cumulativeGasUsed
                    })
                })
                .catch(function(reason) {
                    reject(reason)
                })
        })
    },
    getRandomInt: function(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min
    },
    getRandomBetSize: function() {
        return new BigNumber(this.getRandomInt(1, 5))
            .times(this.getEthInWei())
            .times(this.getRandomBetSizeMultiplier())
            .toFixed(0)
    },
    getRandomCreditsToPurchase: function() {
        return new BigNumber(this.getRandomInt(1000, 5000))
            .times(this.getEthInWei())
            .toFixed(0)
    },
    getRandomBetSizeMultiplier: function() {
        const multipliers = [1, 0.1, 0.01]
        return multipliers[this.getRandomInt(0, 2)]
    },
    getEthInWei: function() {
        return new BigNumber(10).exponentiatedBy(18).toFixed(0)
    },
    convertWeiToEth: function(n) {
        return new BigNumber(n).dividedBy(this.getEthInWei()).toFixed()
    },
    increaseTime: function(bySeconds) {
        myWeb3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_increaseTime',
            params: [bySeconds],
            id: new Date().getTime()
        })
    },

    mineOneBlock: function() {
        myWeb3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_mine',
            id: new Date().getTime()
        })
    },

    mineToBlockHeight: function(targetBlockHeight) {
        while (myWeb3.eth.blockNumber < targetBlockHeight) {
            this.mineOneBlock()
        }
    },
    setWeb3: function(web3) {
        myWeb3 = web3
    },
    getWeb3: function() {
        return web3
    }
}
