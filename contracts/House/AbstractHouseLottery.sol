pragma solidity ^0.4.0;

contract AbstractHouseLottery {

    function pickWinner(uint session) payable returns (bool);

    function allotLotteryTickets(uint session, address _address, uint tokenAmount) returns (bool);

    function updateLotteryPayout(uint session, uint payout) returns (bool);

    function getWinningLotteryTicket(uint session) returns (uint);

    function getLotteryWinner(uint session) returns (address);

    function isLotteryFinalized(uint session) returns (bool);

    function isLotteryClaimed(uint session) returns (bool);

    function isHouseLottery() returns (bool);

}
