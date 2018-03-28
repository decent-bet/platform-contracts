pragma solidity ^0.4.8;

// Adds emergency features to parent contracts
contract EmergencyOptions {

    address public emergencyController;
    bool public emergencyPaused;
    bool public emergencyWithdrawalsEnabled;

    modifier isEmergencyPaused() {
        if(!emergencyPaused) revert();
        _;
    }

    modifier isNotEmergencyPaused() {
        if(emergencyPaused) revert();
        _;
    }

    modifier isEmergencyWithdrawalsEnabled() {
        if(!emergencyWithdrawalsEnabled) revert();
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
        emergencyWithdrawalsEnabled = false;
    }

    function enableEmergencyWithdrawals()
    isEmergencyPaused
    onlyEmergencyController {
        emergencyWithdrawalsEnabled = true;
    }

    function disableEmergencyWithdrawals()
    onlyEmergencyController {
        emergencyWithdrawalsEnabled = false;
    }

}
