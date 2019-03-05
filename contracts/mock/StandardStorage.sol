pragma solidity 0.5.3;


/**
 * @title StandardStorage
 * @notice This is an example of an old-school storage contract.
 */
contract StandardStorage {
  // assign storage for data.
  bytes private _data;

  /**
   * @dev Set the data.
   * @param data bytes The data to store.
   */
  function set(bytes calldata data) external {
    _data = data;
  }

  /**
   * @dev Get the data.
   * @return The stored data.
   */
  function get() external view returns (bytes memory) {
    return _data;
  }
}
