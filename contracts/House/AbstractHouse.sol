pragma solidity ^0.4.8;


contract AbstractHouse {

    /*
     * CALL FUNCTIONS
     */
    // Returns the founder address of the house contract.
    function founder() returns (address founder) {}
    // Returns the current session in the house contract.
    function currentSession() returns (uint session) {}
    // Returns whether the house has been emergency paused.
    function emergencyPaused() returns (bool paused) {}
    // Returns the address of the token contract.
    function decentBetToken() returns (address token) {}
    // Returns the time in the house contract.
    function getTime() returns (uint time) {}
    // Returns the start time of session zero.
    function sessionZeroStartTime() returns (uint time) {}
    // Returns controller contract addresses for the house.
    function getHouseControllers() returns (address authorized, address funds, address sessions) {}

}
