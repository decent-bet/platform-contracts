const MultiSigWallet = artifacts.require('MultiSigWallet')
const DecentBetToken = artifacts.require('TestDecentBetToken')
const UpgradeAgent = artifacts.require('TestUpgradeAgent')
const House = artifacts.require('House')
const HouseAuthorizedController = artifacts.require('HouseAuthorizedController')
const HouseFundsController = artifacts.require('HouseFundsController')
const HouseSessionsController = artifacts.require('HouseSessionsController')
const HouseLottery = artifacts.require('HouseLottery')
const BettingProvider = artifacts.require('BettingProvider')
const BettingProviderHelper = artifacts.require('BettingProviderHelper')
const SportsOracle = artifacts.require('SportsOracle')

const ECVerify = artifacts.require('ECVerify')
const SlotsChannelFinalizer = artifacts.require('SlotsChannelFinalizer')
const SlotsChannelManager = artifacts.require('SlotsChannelManager')
const SlotsHelper = artifacts.require('SlotsHelper')

const utils = require('../test/utils/utils')

let deploy = async (deployer, network) => {
    let decentBetMultisig
    let upgradeMaster, agentOwner
    let startTime, endTime
    let accounts = [process.env.DEFAULT_ACCOUNT]
    web3.eth.defaultAccount = process.env.DEFAULT_ACCOUNT

    let signaturesRequired = 1
    let token,
        upgradeAgent,
        team,
        house,
        houseAuthorizedController,
        houseFundsController,
        houseSessionsController,
        houseLottery,
        bettingProvider,
        bettingProviderHelper,
        sportsOracle,
        slotsHelper,
        slotsChannelFinalizer,
        slotsChannelManager

    let contractInfo = {}

    const getContractInstanceAndInfo = async (contract) => {
        let instance = await contract.deployed()
        contractInfo[contract.contractName] = await utils.getGasUsage(contract, deployer.network_id)
        return instance
    }

    console.log('Deploying with network', network)

    if (network === 'rinkeby' || network === 'development') {
        const timestamp = Math.round(new Date().getTime() / 1000)

        await deployer.deploy(
            MultiSigWallet,
            accounts,
            signaturesRequired
        )
        await getContractInstanceAndInfo(MultiSigWallet)

        upgradeMaster = accounts[0]
        team = accounts[0]
        agentOwner = upgradeMaster
        decentBetMultisig = MultiSigWallet.address

        const ethPrice = 300
        const basePrice = ethPrice / 0.125

        startTime = timestamp + 2 * 24 * 60 * 60
        endTime = timestamp + 28 * 24 * 60 * 60

        try {
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
            token = await getContractInstanceAndInfo(DecentBetToken)

            // Deploy the House contract
            await deployer.deploy(House, token.address)
            house = await getContractInstanceAndInfo(House)

            await deployer.deploy(HouseAuthorizedController, house.address)
            houseAuthorizedController = await getContractInstanceAndInfo(HouseAuthorizedController)
            await house.setHouseAuthorizedControllerAddress(houseAuthorizedController.address)

            await deployer.deploy(HouseFundsController, house.address)
            houseFundsController = await getContractInstanceAndInfo(HouseFundsController)
            await house.setHouseFundsControllerAddress(houseFundsController.address)

            await deployer.deploy(HouseSessionsController, house.address)
            houseSessionsController = await getContractInstanceAndInfo(HouseSessionsController)
            await house.setHouseSessionsControllerAddress(houseSessionsController.address)

            // Deploy the Lottery contract
            await deployer.deploy(HouseLottery)
            houseLottery = await getContractInstanceAndInfo(HouseLottery)

            // Set the house within the lottery contract
            await houseLottery.setHouse.sendTransaction(house.address)

            // Set the house lottery address within the house contract
            await house.setHouseLotteryAddress.sendTransaction(houseLottery.address)

            // Deploy the BettingProviderHelper contract
            await deployer.deploy(BettingProviderHelper)
            bettingProviderHelper = await getContractInstanceAndInfo(BettingProviderHelper)

            // Deploy the BettingProvider contract
            await deployer.deploy(
                BettingProvider,
                token.address,
                house.address,
                houseAuthorizedController.address,
                bettingProviderHelper.address,
                {
                    gas: 6720000
                }
            )
            bettingProvider = await getContractInstanceAndInfo(BettingProvider)

            // Deploy the SportsOracle contract
            await deployer.deploy(SportsOracle, token.address)
            sportsOracle = await getContractInstanceAndInfo(SportsOracle)

            // Deploy the ECVerify Library
            await deployer.deploy(ECVerify)

            // Link the ECVerify Library to the SlotsChannelManager contract
            await deployer.link(ECVerify, SlotsChannelManager)

            // Deploy the SlotsHelper contract
            await deployer.deploy(SlotsHelper)
            slotsHelper = await getContractInstanceAndInfo(SlotsHelper)

            // Deploy the SlotsChannelFinalizer contract
            await deployer.deploy(SlotsChannelFinalizer, slotsHelper.address)
            slotsChannelFinalizer = await getContractInstanceAndInfo(SlotsChannelFinalizer)

            // Deploy the SlotsChannelManager contract
            await deployer.deploy(
                SlotsChannelManager,
                house.address,
                token.address,
                slotsHelper.address,
                slotsChannelFinalizer.address
            )
            slotsChannelManager = await getContractInstanceAndInfo(SlotsChannelManager)

            // Set SlotsChannelManager within the SlotsChannelFinalizer contract
            await slotsChannelFinalizer.setSlotsChannelManager.sendTransaction(
                slotsChannelManager.address
            )

            // Add BettingProvider as a house offering
            await houseSessionsController.addHouseOffering.sendTransaction(
                bettingProvider.address,
                {
                    gas: 3000000
                }
            )

            // Add SlotsChannelManager as a house offering
            await houseSessionsController.addHouseOffering.sendTransaction(
                slotsChannelManager.address,
                {
                    gas: 3000000
                }
            )

            console.log(
                'Deployed:',
                '\nToken: ' + token.address,
                '\nHouse: ' + house.address,
                '\nHouseFundsController: ' + houseFundsController.address,
                '\nHouseAuthorizedController: ' + houseAuthorizedController.address,
                '\nHouseSessionsController: ' + houseSessionsController.address,
                '\nHouseLottery: ' + houseLottery.address,
                '\nSlotsChannelManager: ' + SlotsChannelManager.address,
                '\nBettingProviderHelper: ' + bettingProviderHelper.address,
                '\nBettingProvider: ' + bettingProvider.address,
                '\nSports Oracle: ' + sportsOracle.address,
                '\nSlotsChannelFinalizer: ' + slotsChannelFinalizer.address,
                '\n\nContract info:\n',
                contractInfo
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
