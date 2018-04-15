# Decent.bet Platform contracts

Solidity based smart contracts that power the Decent.bet platform. 

The Decent.bet platform currently supports the following contracts:

* House
* Slots
* BettingProvider
* HouseLottery

## Pre-requisites

* [Yarn](https://yarnpkg.com)
* [Truffle](https://github.com/trufflesuite/truffle)
* [Ganache-cli](https://github.com/trufflesuite/ganache-cli)


## Setting up

1. [Install yarn](https://yarnpkg.com/lang/en/docs/install/)

2. Install [Truffle](https://github.com/trufflesuite/truffle) and [Ganache-cli](https://github.com/trufflesuite/ganache-cli) (beta for Websocket API support)

    ```
        yarn global add truffle ganache-cli@beta
    ```

3. Clone this repository

4. Install the repository packages

    ```
        yarn install
    ```

### Instructions using shell script

* Run Ganache (new shell window)

    **For development (Use a network ID of 10)**
    ```
    ganache-cli --mnemonic "mimic soda meat inmate cup someone labor odor invest scout fat ketchup" -i 10
    ```
* Run prepare-contracts (new shell window), be sure to give it chmod +x
   ```
   ./prepare-contracts
   ```
* Run npm start
    
## Instructions

5. Run Ganache-cli with the following configuration
    
    **For development (Use a network ID of 10)**
    ```
        ganache-cli --mnemonic "mimic soda meat inmate cup someone labor odor invest scout fat ketchup" -i 10
    ```
6. Add an .env file to the current directory with the following variables
   ```
       MNEMONIC='<MNEMONIC TO DEPLOY CONTRACTS AND CONTR˚OL THE PLATFORM>'
       INFURA_KEY='<REGISTERED INFURA KEY>'
       DEFAULT_ACCOUNT='<DEFAULT ACCOUNT LINKED TO YOUR MNEMONIC>'
   ```
       
7. Optionally clone the [platform-frontend](https://github.com/decent-bet/platform-frontend), 
   [admin-frontend](https://github.com/decent-bet/admin-frontend), [games-api](https://github.com/decent-bet/games-api) & [platform-contracts-init](https://github.com/decent-bet/platform-contracts-init) repositories

8. Migrate the contracts to your **ganache-cli** instance

    ```
        truffle migrate
    ```

9. Copy the build/contracts directory to your [platform-frontend](https://github.com/decent-bet/platform-frontend), 
   [admin-frontend](https://github.com/decent-bet/admin-frontend), [games-api](https://github.com/decent-bet/games-api) 
   & [platform-contracts-init](https://github.com/decent-bet/platform-contracts-init) directories.

10. Run [the platform init scripts](https://github.com/decent-bet/platform-contracts-init) to get the platform contracts initialized to a state with session one started with a functional Sportsbook and Slots.

## Running tests

Tests for the House contract - particularly the HouseLotteryController child contract require the oraclize contract which requires [Ethereum Bridge](https://github.com/oraclize/ethereum-bridge) to be running on test networks. 

### Setting up Ethereum Bridge

* Clone the [Ethereum Bridge](https://github.com/oraclize/ethereum-bridge) repository
* Run `npm install`
* Run the bridge in active mode

  ```
  node bridge -H localhost:8545 -a 3
  ```
  
### Available Tests

* All tests

  ```
  yarn run test
  ```

* House contracts (Includes Authorized, Funds, Lottery and Sessions controller contracts)

  ```
  yarn run test-house
  ```
  
* Slots channel manager contract

  ```
  yarn run test-slots
  ```
