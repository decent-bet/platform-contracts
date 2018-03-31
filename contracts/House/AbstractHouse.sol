pragma solidity ^0.4.8;


contract AbstractHouse {

    function founder() returns (address) {}
    function currentSession() returns (uint) {}
    function isSessionActive(uint session) returns (bool) {}
    function emergencyPaused() returns (bool) {}
    function decentBetToken() returns (address) {}
    function getTime() returns (uint) {}
    function sessionZeroStartTime() returns (uint) {}
    function getHouseControllers() returns (address, address, address) {}

    function transferProfits(address winner, uint amount) returns (bool) {}

}
