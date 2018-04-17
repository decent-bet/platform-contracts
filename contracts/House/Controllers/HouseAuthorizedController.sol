pragma solidity ^0.4.19;

import '../House.sol';

contract HouseAuthorizedController {

    // Variables
    House public house;

    address[] public authorizedAddresses;
    bool public isHouseAuthorizedController = true;

    // Authorized addresses.
    mapping (address => bool) public authorized;

    function HouseAuthorizedController(address _house) {
        if(_house == 0x0) revert();
        house = House(_house);
        addToAuthorizedAddresses(house.founder());
    }

    // Modifiers
    // Allows functions to execute only if the house contract sent the transaction.
    modifier onlyHouse() {
        if(msg.sender != address(house)) revert();
        _;
    }

    modifier onlyFounder() {
        if(msg.sender != house.founder()) revert();
        _;
    }

    // Adds an address to the list of authorized addresses.
    function addToAuthorizedAddresses(address _address)
    onlyFounder returns (bool) {
        authorizedAddresses.push(_address);
        authorized[_address] = true;
        return true;
    }

    // Removes an address from the list of authorized addresses.
    function removeFromAuthorizedAddresses(address _address)
    onlyFounder returns (bool) {
        if(_address == msg.sender) revert();
        if (authorized[_address] == false) revert();
        for (uint i = 0; i < authorizedAddresses.length; i++) {
            if (authorizedAddresses[i] == _address) {
                delete authorizedAddresses[i];
                authorized[_address] = false;
                break;
            }
        }
        return true;
    }

}
