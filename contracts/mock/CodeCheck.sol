pragma solidity 0.5.3;


/**
 * @title CodeCheck
 * @notice This contract checks the deployed runtime code of another contract.
 */
contract CodeCheck {
  function check(address target) public view returns (bytes memory code) {
    assembly {
      // retrieve the size of the external code
      let size := extcodesize(target)
      // allocate output byte array
      code := mload(0x40)
      // new "memory end" including padding
      mstore(0x40, add(code, and(add(size, 0x3f), not(0x1f))))
      // store length in memory
      mstore(code, size)
      // get the code using extcodecopy
      extcodecopy(target, add(code, 0x20), 0, size)
    }
  }

  function hash(address target) public view returns (bytes32 codehash) {
    assembly {
      // retrieve keccak256 hash of target
      codehash := extcodehash(target)
    }
  }  
}
