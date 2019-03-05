pragma solidity 0.5.3;


/**
 * @title RStoreCaller
 * @notice This example contract calls into a metamorphic storage contract.
 */
contract RStoreCaller {
  address private _storage;
  address private _fallbackStorage;

  /**
   * @dev Set up the remote storage contract in the constructor.
   * @param storageContract address The address of the primary metamorphic
   * contract.
   * @param storageContract address The address of the secondary metamorphic
   * contract.
   */
  constructor(address storageContract, address fallbackStorageContract) public {
    _storage = storageContract;
    _fallbackStorage = fallbackStorageContract;
  }

  /**
   * @dev Get the data from the runtime code of the current metamorphic
   * contract.
   * @return The data stored in the runtime code of the current metamorphic
   * contract.
   */
  function get() external view returns (bytes memory words) {
    address metamorphicStorageContract = _storage;

    bytes32 codehash;
    assembly {
      // retrieve keccak256 hash of target
      codehash := extcodehash(metamorphicStorageContract)
    } /* solhint-enable no-inline-assembly */

    if (codehash == bytes32(0)) {
      metamorphicStorageContract = _fallbackStorage;
    }

    assembly {
      // retrieve the size of the external code (subtracting the control word)
      let size := sub(extcodesize(metamorphicStorageContract), 32)
      // allocate output byte array
      words := mload(0x40)
      // new "memory end" including padding
      mstore(0x40, add(words, and(add(size, 0x3f), not(0x1f))))
      // store length in memory
      mstore(words, size)
      // get the code using extcodecopy
      extcodecopy(metamorphicStorageContract, add(words, 0x20), 32, size)
    }
  }
}
