pragma solidity ^0.4.8;


contract AbstractHouse {

    function owner() returns (address) {}
    function authorized(address _address) returns (bool) {}
    function currentSession() returns (uint) {}
    function isSessionActive(uint session) returns (bool) {}
    function emergencyPaused() returns (bool) {}
    function decentBetToken() returns (address) {}

    function transferProfits(address winner, uint amount) returns (bool) {}

}
