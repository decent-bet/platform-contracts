pragma solidity ^0.4.0;

contract AbstractSlotsChannelManager {

    /*
     * CALL FUNCTIONS
     */
    // Returns player address for a channel.
    function getPlayer(uint id, bool isHouse) returns (address player);
    // Returns whether a channel is finalized and it's final nonce if finalized.
    function getChannelFinalized(uint id) constant returns (bool finalized, uint finalNonce);
    // Returns whether an address is a participant in a channel.
    function isParticipant(uint id, address _address) returns (bool isParticipant);

    /*
     * STATE CHANGING FUNCTIONS
     */
    // Allows the finalizer contract to set the final variables for a channel.
    function setFinal(uint id, uint userBalance, uint houseBalance, uint nonce, bool turn);

}
