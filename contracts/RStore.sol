pragma solidity 0.5.3;


/**
 * @title RStore
 * @author 0age
 * @notice This contract uses metamorphic contracts in place of standard storage
 * in order to save gas for certain applications. Then, extcodecopy is used to
 * retrieve values from the runtime bytecode of a metamorphic contract, which
 * can be redeployed after a selfdestruct in order to update storage. This is
 * bleeding-edge stuff, so use at your own risk!
 * @dev There are actually two different metamorphic contracts that are used in
 * alternating order to support single-transaction storage updates. Each caller
 * also has their own, independent associated metamorphic storage contracts.
 * Gas usage can almost certainly be optimized further from here - this is meant
 * to serve as a proof-of-concept of using contract runtime code for storage.
 */
contract RStore {
  // allocate transient storage that will be stored temporarily.
  bytes32[] private _transientStorage;

  // set initialization code hash for metamorphic storage contract as a constant
  bytes32 private constant METAMORPHIC_INIT_CODE_HASH = (
    bytes32(0x27094799a16bc7cc7760e8d52c3143138fd63d3943475dc8b2c4e6af70eb6830)
  );

  /**
   * @dev Set the data in the runtime code of a metamorphic contract.
   * @param data bytes The data to store in the metamorphic contract.
   */
  function set(bytes calldata data) external {
    // pull words from calldata into storage, converting from bytes to bytes32[]
    bytes32 word;
    for (uint256 i = 68; i < data.length + 68; i = i + 32) {
      assembly { word := calldataload(i) }
      _transientStorage.push(word);
    }

    // metamorphic init code: insert control word, get data, and deploy runtime.
    bytes memory metamorphicInitCode = (
      hex"5860008158601c335a630c85c0028752fa153d602090039150607381533360601b600152653318585733ff60d01b601552602080808403918260d81b601b52602001903ef3"
    );

    // calculate the contract address of the primary metamorphic contract.
    address targetMetamorphicContract = _getPrimaryMetamorphicContractAddress();

    // load metamorphic contract init code & size and deploy via CREATE2.
    address deployedMetamorphicContract;
    assembly {
      // determine if the primary contract already exists; if so, use secondary
      let codehash := extcodehash(targetMetamorphicContract)
      let encoded_data := add(0x20, metamorphicInitCode) // load init code.
      let encoded_size := mload(metamorphicInitCode)     // init code's length.
      deployedMetamorphicContract := create2( // call CREATE2 with 4 arguments.
        0,                                    // do not forward any endowment.
        encoded_data,                         // pass in initialization code.
        encoded_size,                         // pass in init code's length.
        add(caller, iszero(eq(codehash, 0)))  // calling address + flag as salt.
      )
    }

    // ensure that the metamorphic contract was successfully deployed.
    require(
      deployedMetamorphicContract != address(0),
      "Failed to deploy a metamorphic storage contract with the supplied data."
    );

    // delete the transient storage to refund 15,000 gas per stored word.
    delete _transientStorage;

    // delete the other, old metamorphic contract to refund 24,000 gas.
    if (deployedMetamorphicContract != targetMetamorphicContract) {
      // delete the primary metamorphic contract.
      targetMetamorphicContract.call("");
    } else {
      // find the secondary contract address and delete it if it exists.
      address secondary = _getSecondaryMetamorphicContractAddress();
      secondary.call("");
    }
  }

  /**
   * @dev Delete the active metamorphic contract - this may need to be called
   * twice in order to fully clear all storage.
   */
  function clear() external returns (bool ok) {
    address metamorphicStorageContract = _getMetamorphicContractAddress();
    (ok, ) = metamorphicStorageContract.call("");
  }

  /**
   * @dev get the data from the associated metamorphic contract.
   * @return the data stored at the associated metamorphic contract.
   */
  function get() external view returns (bytes memory data) {
    address metamorphicStorageContract = _getMetamorphicContractAddress();

    assembly {
      data := mload(0x40)
      // retrieve the size of the external code (subtracting the control word)
      let size := sub(extcodesize(metamorphicStorageContract), 0x20) 
      // new "memory end" including padding
      mstore(0x40, add(data, and(add(size, 0x3f), not(0x1f))))
      // store length in memory
      mstore(data, size)
      // get the code using extcodecopy
      extcodecopy(metamorphicStorageContract, add(data, 0x20), 0x20, size)
    }
  }

  /**
   * @dev Get transient storage - called by the metamorphic storage contract as
   * part of its initialization.
   * @return The data to store in the metamorphic storage contract's runtime
   * code.
   */
  function getTransientStorage() external view returns (bytes memory) {
    return abi.encodePacked(_transientStorage);
  }

  /**
   * @dev Get the addresses of the primary and secondary metamorphic storage
   * contracts for a given caller.
   * @return The addresses of the primary and secondary metamorphic storage
   * contracts for a given caller.
   */
  function getMetamorphicStorageContractAddresses() external view returns (
    address primary, address secondary
  ) {
    return (
      _getPrimaryMetamorphicContractAddress(),
      _getSecondaryMetamorphicContractAddress()
    );
  }

  /**
   * @dev Get the initialization code used to deploy each metamorphic storage
   * contract.
   * @return The initialization code used to deploy each metamorphic storage
   * contract.
   */
  function getMetamorphicStorageContractInitializationCode() external pure returns (bytes memory) {
    return hex"5860008158601c335a630c85c0028752fa153d602090039150607381533360601b600152653318585733ff60d01b601552602080808403918260d81b601b52602001903ef3";
  }

  /**
   * @dev Get the keccak256 hash of the initialization code used to deploy each
   * metamorphic storage contract.
   * @return The keccak256 hash of the initialization code used to deploy each
   * metamorphic storage contract.
   */
  function getMetamorphicStorageContractInitializationCodeHash() external pure returns (bytes32) {
    return METAMORPHIC_INIT_CODE_HASH;
  }

  /**
   * @dev Internal view function for calculating the current metamorphic
   * contract address holding data on behalf of a particular caller.
   */
  function _getMetamorphicContractAddress() internal view returns (
    address metamorphicContract
  ) {
    // determine the address of the primary metamorphic contract.
    metamorphicContract = _getPrimaryMetamorphicContractAddress();

    // check the code hash of the runtime code deployed to the primary address.
    bytes32 codehash;
    assembly { codehash := extcodehash(metamorphicContract) }

    // if there is no code at the primary address, instead return the secondary.
    if (codehash == bytes32(0)) {
      metamorphicContract = _getSecondaryMetamorphicContractAddress();      
    }
  }

  /**
   * @dev Internal view function for calculating the primary metamorphic
   * contract address that can hold data on behalf of a particular caller.
   */
  function _getPrimaryMetamorphicContractAddress() internal view returns (address) {
    // determine the address of the destroyable metamorphic contract.
    return address(
      uint160(                      // downcast uint to match the address type.
        uint256(                    // convert to uint to truncate upper digits.
          keccak256(                // compute the CREATE2 hash using 4 inputs.
            abi.encodePacked(       // pack all inputs to the hash together.
              hex"ff",              // start with 0xff to distinguish from RLP.
              address(this),        // this contract will be the caller.
              uint256(              // convert to uint to leftpad upper digits.
                uint160(            // downcast uint to match the address type.
                  msg.sender        // pass in the calling address for the salt.
                )
              ),                 
              METAMORPHIC_INIT_CODE_HASH // pass in the hash of the init code.
            )
          )
        )
      )
    );
  }

  /**
   * @dev Internal view function for calculating the primary metamorphic
   * contract address that can hold data on behalf of a particular caller.
   */
  function _getSecondaryMetamorphicContractAddress() internal view returns (address) {
    // determine the address of the destroyable metamorphic contract.
    return address(
      uint160(                      // downcast uint to match the address type.
        uint256(                    // convert to uint to truncate upper digits.
          keccak256(                // compute the CREATE2 hash using 4 inputs.
            abi.encodePacked(       // pack all inputs to the hash together.
              hex"ff",              // start with 0xff to distinguish from RLP.
              address(this),        // this contract will be the caller.
              uint256(              // convert to uint to leftpad upper digits.
                uint160(            // downcast uint to match the address type.
                  msg.sender        // pass in the calling address for the salt.
                ) + 1               // add 1 to the caller for secondary.
              ),                 
              METAMORPHIC_INIT_CODE_HASH  // pass in the hash of the init code.
            )
          )
        )
      )
    );
  }
}
