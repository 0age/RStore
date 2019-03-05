pragma solidity 0.5.3;


/**
 * @title StandardStorageInterface
 * @notice This is an interface to an example of an old-school storage contract.
 */
interface StandardStorageInterface {
  function get() external view returns (bytes memory);
}


/**
 * @title StandardCaller
 * @notice This example contract gets data from a contract with old-school
 * storage.
 */
contract StandardCaller {
  // assign storage for the remote data source.
  StandardStorageInterface private _storage;

  /**
   * @dev Set up the remote storage contract interface in the constructor.
   * @param storageContract address The address of the remote data source.
   */
  constructor(address storageContract) public {
    _storage = StandardStorageInterface(storageContract);
  }

  /**
   * @dev Get the data from remote storage.
   * @return The data stored at the remote source.
   */
  function get() external view returns (bytes memory) {
    return _storage.get();
  }
}
