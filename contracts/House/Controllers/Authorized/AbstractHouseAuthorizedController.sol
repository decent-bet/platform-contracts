pragma solidity ^0.4.0;

contract AbstractHouseAuthorizedController {

    function addToAuthorizedAddresses(address _address) returns (bool) {}
    function removeFromAuthorizedAddresses(address _address) returns (bool) {}

    function isHouseAuthorizedController() returns (bool) {}
    function authorized(address _address) returns (bool) {}

}
