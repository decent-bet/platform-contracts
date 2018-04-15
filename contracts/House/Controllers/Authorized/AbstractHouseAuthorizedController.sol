pragma solidity ^0.4.0;

contract AbstractHouseAuthorizedController {

    /*
     * CALL FUNCTIONS
     */
    // Returns whether the contract is a house authorized controller contract.
    function isHouseAuthorizedController() returns (bool isHouseAuthorizedController) {}
    // Returns whether the address is authorized
    function authorized(address _address) returns (bool isAuthorized) {}

    /*
     * STATE CHANGING FUNCTIONS
     */
    // Adds an address to the authorized addresses.
    function addToAuthorizedAddresses(address _address) returns (bool added) {}
    // Removes an address from the authorized address mapping and array.
    function removeFromAuthorizedAddresses(address _address) returns (bool removed) {}

}
