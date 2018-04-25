const symbolA = 1,
    symbolB = 2,
    symbolC = 3,
    symbolD = 4,
    symbolE = 5,
    symbolF = 6,
    symbolG = 7

const NUMBER_OF_LINES = 5,
    NUMBER_OF_REELS = 5

const reels = [
    [7, 2, 2, 1, 5, 3, 5, 3, 2, 2, 3, 4, 2, 5, 1, 1, 6, 4, 1, 5, 3], //0
    [1, 1, 3, 3, 5, 3, 5, 1, 2, 2, 4, 1, 3, 4, 3, 2, 2, 6, 6, 3, 7], //1
    [4, 2, 7, 3, 2, 6, 1, 4, 3, 1, 5, 1, 1, 4, 4, 1, 5, 2, 2, 1, 1], //2
    [1, 1, 5, 1, 2, 7, 4, 2, 1, 3, 2, 2, 3, 1, 1, 2, 6, 2, 6, 3, 5], //3
    [1, 4, 1, 1, 2, 4, 1, 3, 6, 2, 7, 2, 4, 1, 3, 1, 3, 6, 1, 2, 5] //4
]

const paytable = {}
paytable[symbolA] = 10
paytable[symbolB] = 20
paytable[symbolC] = 40
paytable[symbolD] = 50
paytable[symbolE] = 75
paytable[symbolF] = 150
paytable[symbolG] = 300

const privateKeys = {
    nonFounder:
        '0x5c7f17702c636b560743b0dcb1b1d2b18e64de0667010ca4d9cac4f7119d0428',
    house: '0xf670adee34d38fc203ff707d7e7ef8946a6bb74fffdfc8d1a44c1e63eae86141',
    nonParticipant:
        '0xaf73426c6308b24bc720056ef3d1471ab7b531b2963de54d6ec6bb80153ec41d'
}

const availablePrivateKeys = [
    '0xf670adee34d38fc203ff707d7e7ef8946a6bb74fffdfc8d1a44c1e63eae86141',
    '0x5c7f17702c636b560743b0dcb1b1d2b18e64de0667010ca4d9cac4f7119d0428',
    '0xaf73426c6308b24bc720056ef3d1471ab7b531b2963de54d6ec6bb80153ec41d',
    '0x691cf34753c73c8ace9bc5bae7d6129145d018acfeb10bb3af13f0a2dffc6f61',
    '0xd4a457207e67cd8f4fd5f84298bc596b6b0eb579fbca8aef390f7b342c3df2d2',
    '0x05b10b699279d44310761495cfdbfd32fc11998b6495bf203e9a000011388da6',
    '0x05f95335be849b96cd7909f91ee3751dabdcb21df68e3be7c7f297e2034bfd7a',
    '0x18ade2ac66c72f4df17f25b739db14ff48bb66d7eea6b4702f7c96296b2989d7',
    '0xfb20dbe42a41a51484ab847180eeee683b10e6aad066c3c39a76f3b6e18274e4',
    '0x2572fd36ca6158356ccc98a7fd22538a9bb98d397492a85004271ce53dcd3539'
]

module.exports = {
    NUMBER_OF_LINES,
    NUMBER_OF_REELS,
    paytable,
    privateKeys,
    availablePrivateKeys,
    reels
}
