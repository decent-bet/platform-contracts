pragma solidity 0.4.21;


import './strings.sol';


// Utility functions used by contracts on the decent.bet platform
contract Utils {

    using strings for *;

    function parseBool(string b)
    internal
    pure
    returns (bool) {
        if (strCompare(b, 'false')) return false;
        else if (strCompare(b, 'true')) return true;
        else revert();
    }

    function bytes32ToBool(bytes32 b)
    public
    pure
    returns (bool) {
        if (b == 0) return false;
        else if (b == 1) return true;
        else revert();
    }

    function parseInt(string _a)
    internal
    pure
    returns (uint) {
        return parseInt(_a, 0);
    }

    // parseInt(parseFloat*10^_b)
    function parseInt(string _a, uint _b)
    internal
    pure
    returns (uint) {
        bytes memory bresult = bytes(_a);
        uint mint = 0;
        bool decimals = false;
        for (uint i = 0; i < bresult.length; i++) {
            if ((bresult[i] >= 48) && (bresult[i] <= 57)) {
                if (decimals) {
                    if (_b == 0) break;
                    else _b--;
                }
                mint *= 10;
                mint += uint(bresult[i]) - 48;
            }
            else if (bresult[i] == 46) decimals = true;
        }
        if (_b > 0) mint *= 10 ** _b;
        return mint;
    }

    // Helper function to easily slice and count string length
    function strLen(string _string)
    public
    pure
    returns (uint) {
        return _string.toSlice().len();
    }

    // Helper function to compare two strings
    function strCompare(string s1, string s2)
    public
    pure
    returns (bool) {
        int result = s1.toSlice().compare(s2.toSlice());
        return result == 0;
    }

    // Helper function to return char at a certain position
    function getCharAt(string s, uint index)
    public
    pure
    returns (string) {
        bytes memory b = bytes(s);
        string memory char = new string(1);
        bytes memory bChar = bytes(char);
        bChar[0] = b[index];
        return string(bChar);
    }

    function strConcat(string _a, string _b, string _c, string _d, string _e)
    internal
    pure
    returns (string) {
        bytes memory _ba = bytes(_a);
        bytes memory _bb = bytes(_b);
        bytes memory _bc = bytes(_c);
        bytes memory _bd = bytes(_d);
        bytes memory _be = bytes(_e);
        string memory abcde = new string(_ba.length + _bb.length + _bc.length + _bd.length + _be.length);
        bytes memory babcde = bytes(abcde);
        uint k = 0;
        for (uint i = 0; i < _ba.length; i++) babcde[k++] = _ba[i];
        for (i = 0; i < _bb.length; i++) babcde[k++] = _bb[i];
        for (i = 0; i < _bc.length; i++) babcde[k++] = _bc[i];
        for (i = 0; i < _bd.length; i++) babcde[k++] = _bd[i];
        for (i = 0; i < _be.length; i++) babcde[k++] = _be[i];
        return string(babcde);
    }

    function strConcat(string _a, string _b, string _c, string _d)
    internal
    pure
    returns (string) {
        return strConcat(_a, _b, _c, _d, '');
    }

    function strConcat(string _a, string _b, string _c)
    internal
    pure
    returns (string) {
        return strConcat(_a, _b, _c, '', '');
    }

    function strConcat(string _a, string _b)
    internal
    pure
    returns (string) {
        return strConcat(_a, _b, '', '', '');
    }

    function uintToBytes(uint v)
    public
    pure
    returns (bytes32 ret) {
        if (v == 0) {
            ret = '0';
        }
        else {
            while (v > 0) {
                ret = bytes32(uint(ret) / (2 ** 8));
                ret |= bytes32(((v % 10) + 48) * 2 ** (8 * 31));
                v /= 10;
            }
        }
        return ret;
    }

    function bytes32ToString(bytes32 x)
    public
    pure
    returns (string) {
        bytes memory bytesString = new bytes(32);
        uint charCount = 0;
        for (uint j = 0; j < 32; j++) {
            byte char = byte(bytes32(uint(x) * 2 ** (8 * j)));
            if (char != 0) {
                bytesString[charCount] = char;
                charCount++;
            }
        }
        bytes memory bytesStringTrimmed = new bytes(charCount);
        for (j = 0; j < charCount; j++) {
            bytesStringTrimmed[j] = bytesString[j];
        }
        return string(bytesStringTrimmed);
    }

    function uintToString(uint n)
    public
    pure
    returns (string) {
        bytes32 b = uintToBytes(n);
        return bytes32ToString(b);
    }

    function boolToString(bool b)
    public
    pure
    returns (string) {
        if (b == true)
        return "true";
        else if (b == false)
        return "false";
    }

    function toBytes32(string self, uint startIndex)
    public
    pure
    returns (bytes32 b) {
        uint l = 32;
        bytes memory bs = toBytes(self, startIndex, l);

        for (uint x = 0; x < l; x++) {
            b = bytes32(uint(b) + uint(uint(bs[x]) * (2 ** (8 * (l - 1 - x)))));
        }
    }

    function toBytes(string self, uint startIndex, uint length)
    internal
    pure
    returns (bytes) {
        bytes memory str = bytes(self);
        bytes memory bs = new bytes(length);
        uint maxIndex = ((str.length - startIndex) < (length * 2) ? (str.length - startIndex) : startIndex + (length * 2));

        for (uint i = startIndex; i < maxIndex; i++) {
            uint ii = i - startIndex;
            bs[ii / 2] = byte(uint8(bs[ii / 2]) + (uint8(toByte(str[i])) * uint8(16 ** (1 - (ii % 2)))));
        }

        return bs;
    }

    function toByte(byte char)
    public
    pure
    returns (byte c) {
        if (uint8(char) > 0x57) return byte(uint8(char) - 0x57);
        else return byte(uint8(char) - 0x30);
    }

}
