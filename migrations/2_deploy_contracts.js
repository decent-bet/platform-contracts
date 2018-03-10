const MultiSigWallet = artifacts.require('MultiSigWallet')
const DecentBetToken = artifacts.require('TestDecentBetToken')
const House = artifacts.require('House')

const ECVerify = artifacts.require('ECVerify')
const SlotsChannelFinalizer = artifacts.require('IndependentSlotsChannelFinalizer')
const SlotsChannelManager = artifacts.require('IndependentSlotsChannelManager')
const SlotsHelper = artifacts.require('SlotsHelper')

let deploy = async (deployer, network) => {
    let decentBetMultisig
    let upgradeMaster, agentOwner
    let startTime, endTime
    let accounts = [process.env.DEFAULT_ACCOUNT]
    web3.eth.defaultAccount = process.env.DEFAULT_ACCOUNT

    let signaturesRequired = 1
    let token,
        wallet,
        team,
        slotsHelper,
        slotsChannelFinalizer,
        slotsChannelManager

    console.log('Deploying with network', network)

    if (network === 'rinkeby' || network === 'development') {
        try {
            const timestamp = Math.round(new Date().getTime() / 1000)

            wallet = await deployer.deploy(
                MultiSigWallet,
                accounts,
                signaturesRequired
            )

            upgradeMaster = accounts[0]
            team = accounts[0]
            decentBetMultisig = MultiSigWallet.address

            const ethPrice = 300
            const basePrice = ethPrice / 0.125

            startTime = timestamp + 2 * 24 * 60 * 60
            endTime = timestamp + 28 * 24 * 60 * 60
            // Deploy the DecentBetToken contract
            await deployer.deploy(
                DecentBetToken,
                decentBetMultisig,
                upgradeMaster,
                team,
                basePrice,
                startTime,
                endTime
            )
            token = await DecentBetToken.deployed()

            // Deploy the ECVerify Library
            await deployer.deploy(ECVerify)

            // Link the ECVerify Library to the SlotsChannelManager contract
            await deployer.link(ECVerify, SlotsChannelManager)

            // Deploy the SlotsHelper contract
            await deployer.deploy(SlotsHelper)
            slotsHelper = await SlotsHelper.deployed()

            // Deploy the SlotsChannelFinalizer contract
            await deployer.deploy(SlotsChannelFinalizer, slotsHelper.address)
            slotsChannelFinalizer = await SlotsChannelFinalizer.deployed()

            // Deploy the SlotsChannelManager contract
            await deployer.deploy(
                SlotsChannelManager,
                token.address,
                slotsHelper.address,
                slotsChannelFinalizer.address
            )
            slotsChannelManager = await SlotsChannelManager.deployed()

            // Set SlotsChannelManager within the SlotsChannelFinalizer contract
            await slotsChannelFinalizer.setSlotsChannelManager.sendTransaction(
                slotsChannelManager.address
            )

            console.log(
                'Deployed:',
                '\nToken: ' + token.address,
                '\nSlotsChannelManager: ' + SlotsChannelManager.address,
                '\nSlotsChannelFinalizer: ' + slotsChannelFinalizer.address
            )
        } catch (e) {
            console.log('Error deploying contracts', e.message)
        }
    } else if (network === 'mainnet') {
        try {
            await MultiSigWallet.at(utils.multisigWalletAddressMainNet)
            upgradeMaster = web3.eth.accounts[0]
            agentOwner = upgradeMaster
            decentBetMultisig = MultiSigWallet.address
            let startBlock = startBlockMainNet
            let endBlock = endBlockMainNet
            await deployer.deploy(
                DecentBetToken,
                decentBetMultisig,
                upgradeMaster,
                startBlock,
                endBlock
            )
            token = await DecentBetToken.deployed()

            // Deploy UpgradeAgent contract
            let gasEstimate = 2000000
            await deployer.deploy(UpgradeAgent, token.address, {
                from: agentOwner,
                gas: gasEstimate + utils.gasEpsilon
            })
            upgradeAgent = await UpgradeAgent.deployed()
            await token.setUpgradeAgent(upgradeAgent.address)
        } catch (e) {
            console.log('Error deploying contracts', e.message)
        }
    }
}

module.exports = function(deployer, network) {
    // Work-around to stage tasks in the migration script and not actually run them
    // https://github.com/trufflesuite/truffle/issues/501#issuecomment-332589663
    deployer.then(() => deploy(deployer, network))
}
