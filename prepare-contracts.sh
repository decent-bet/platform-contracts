#!/bin/bash -eux

truffle migrate
cp -R build/ ../platform-frontend
cp -R build/ ../admin-frontend
cp -R build/ ../games-api
cp -R build/ ../platform-contracts-init
cd ../platform-contracts-init
yarn run init --privateKey "0xf670adee34d38fc203ff707d7e7ef8946a6bb74fffdfc8d1a44c1e63eae86141"