pragma solidity 0.4.21;

import "../House.sol";
import "../../Libraries/SafeMath.sol";

contract HouseAuthorizedController is SafeMath {

    // Variables
    House public house;
    bool public isHouseAuthorizedController = true;

    // Authorized addresses.
    address[] public authorizedAddresses;
    mapping (address => bool) public authorized;
    uint authorizedAddressCount;

    function HouseAuthorizedController(address _house)
    public {
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
    onlyFounder
    public
    returns (bool) {
        require(!authorized[_address]);
        authorizedAddresses.push(_address);
        authorized[_address] = true;
        authorizedAddressCount = safeAdd(authorizedAddressCount, 1);
        return true;
    }

    // Removes an address from the list of authorized addresses.
    function removeFromAuthorizedAddresses(address _address)
    onlyFounder
    public
    returns (bool) {
        require(_address != msg.sender);
        require(authorized[_address]);
        for (uint i = 0; i < authorizedAddresses.length; i++) {
            if (authorizedAddresses[i] == _address) {
                delete authorizedAddresses[i];
                authorized[_address] = false;
                authorizedAddressCount = safeSub(authorizedAddressCount, 1);
                break;
            }
        }
        return true;
    }

}
