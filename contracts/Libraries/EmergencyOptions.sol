pragma solidity ^0.4.19;

// Adds emergency features to parent contracts
contract EmergencyOptions {

    address public emergencyController;
    bool public emergencyPaused;
    bool public emergencyWithdrawalsEnabled;

    modifier isEmergencyPaused() {
        require(emergencyPaused);
        _;
    }

    modifier isNotEmergencyPaused() {
        require(!emergencyPaused);
        _;
    }

    modifier isEmergencyWithdrawalsEnabled() {
        require(emergencyWithdrawalsEnabled);
        _;
    }

    modifier onlyEmergencyController() {
        require(msg.sender == emergencyController);
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
