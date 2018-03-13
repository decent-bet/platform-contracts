#!/bin/bash -eux

truffle migrate

copyContracts () {
    rm -rf ../$1/build
    mkdir ../$1/build
    cp -r ./build/contracts ../$1/build
}

copyContracts platform-frontend
copyContracts admin-frontend
copyContracts games-api
copyContracts platform-contracts-init

cd ../platform-contracts-init
yarn run init -- "0xf670adee34d38fc203ff707d7e7ef8946a6bb74fffdfc8d1a44c1e63eae86141"