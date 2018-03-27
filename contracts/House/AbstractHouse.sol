pragma solidity ^0.4.8;


contract AbstractHouse {

    function owner() returns (address) {}
    function authorized(address _address) returns (bool) {}
    function transferProfits(address winner, uint amount) returns (bool) {}
    function currentSession() returns (uint) {}
    function isSessionActive(uint session) returns (bool) {}
    function isCreditBuyingPeriod() returns (bool) {}
    function isProfitDistributionPeriod(uint session) returns (bool) {}
    function decentBetToken() returns (address) {}

}
