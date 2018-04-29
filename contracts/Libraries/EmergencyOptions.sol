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

    function EmergencyOptions() public {
        emergencyController = msg.sender;
    }

    function setEmergencyController(address _emergencyController)
    onlyEmergencyController
    public {
        emergencyController = _emergencyController;
    }

    function emergencyPause()
    onlyEmergencyController
    public {
        emergencyPaused = true;
    }

    function emergencyUnPause()
    onlyEmergencyController
    public {
        emergencyPaused = false;
        emergencyWithdrawalsEnabled = false;
    }

    function enableEmergencyWithdrawals()
    isEmergencyPaused
    onlyEmergencyController
    public {
        emergencyWithdrawalsEnabled = true;
    }

    function disableEmergencyWithdrawals()
    onlyEmergencyController
    public {
        emergencyWithdrawalsEnabled = false;
    }

}
