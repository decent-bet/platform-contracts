pragma solidity ^0.4.0;

contract AbstractSlotsChannelManager {

    function getPlayer(uint id, bool isHouse) returns (address);
    function getChannelFinalized(uint id) constant returns (bool, uint);
    function isChannelFinalizeable(uint id) constant returns (bool);
    function isParticipant(uint id, address _address) returns (bool);
    function setFinal(uint id, uint userBalance, uint houseBalance, uint nonce, bool turn);

}
