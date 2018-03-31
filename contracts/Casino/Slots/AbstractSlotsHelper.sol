pragma solidity ^0.4.0;


contract AbstractSlotsHelper {

    /*
     * CALL FUNCTIONS
     */
    // Returns whether the contract is a slots helper contract.
    function isSlotsHelper() returns (bool isSlotsHelper);
    // Converts an input reel string into an array of uints.
    function convertReelToArray(string reel) returns (uint[5] reelArray);
    // Returns the total reward for a reel based on a bet size.
    function getTotalReward(uint betSize, uint[5] reelArray) returns (uint totalReward);

}
