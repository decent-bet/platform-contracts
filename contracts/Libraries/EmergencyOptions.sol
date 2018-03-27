pragma solidity ^0.4.8;

// Adds emergency features to parent contracts
contract EmergencyOptions {

    address emergencyController;
    bool emergencyPaused;

    modifier isEmergencyPaused() {
        if(!emergencyPaused) revert();
        _;
    }

    modifier onlyEmergencyController() {
        if(msg.sender != emergencyController) revert();
        _;
    }

    function EmergencyOptions() {
        emergencyController = msg.sender;
    }

    function setEmergencyController(address _emergencyController) onlyEmergencyController {
        emergencyController = _emergencyController;
    }

    function emergencyPause() onlyEmergencyController {
        emergencyPaused = true;
    }

    function emergencyUnPause() onlyEmergencyController {
        emergencyPaused = false;
    }

}
