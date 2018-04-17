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
        require(_house != 0x0);
        house = House(_house);
        addToAuthorizedAddresses(house.founder());
    }

    // Modifiers
    // Allows functions to execute only if the house contract sent the transaction.
    modifier onlyHouse() {
        require(msg.sender == address(house));
        _;
    }

    modifier onlyFounder() {
        require(msg.sender == house.founder());
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
        require(_address != msg.sender);
        require(authorized[_address]);
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
