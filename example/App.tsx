/**
 * Sample BLE React Native App
 */

import React, { useState, useEffect } from 'react';
import {
	SafeAreaView,
	StyleSheet,
	View,
	Text,
	StatusBar,
	NativeModules,
	NativeEventEmitter,
	Platform,
	PermissionsAndroid,
	FlatList,
	TouchableHighlight,
	Pressable,
	Image,
} from 'react-native';

import { Colors } from 'react-native/Libraries/NewAppScreen';

const SECONDS_TO_SCAN_FOR = 0; // Scan until user click stop
const SERVICE_UUIDS: string[] = [];
const ALLOW_DUPLICATES = false;
const WWV_DEVICE_NAME = 'ESP32';
const WWV_WINDANGLE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const WWV_WINDANGLE_CHAR = ['beb5483e-36e1-4688-b7f5-ea07361b26a8', 'beb5483e-36e1-4688-b7f5-cafecafee270'];

import BleManager, {
	BleDisconnectPeripheralEvent,
	BleManagerDidUpdateValueForCharacteristicEvent,
	BleScanCallbackType,
	BleScanMatchMode,
	BleScanMode,
	Peripheral,
} from 'react-native-ble-manager';
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

declare module 'react-native-ble-manager' {
	// enrich local contract with custom state properties needed by App.tsx
	interface Peripheral {
		connected?: boolean;
		connecting?: boolean;
	}
}

var currentPeriph:Peripheral;

const App = () => {
	const [angle, setAngle] = useState(0);
	const [status, setStatus] = useState('');
	const [meanAngle, setMeanAngle] = useState(0);
	const [windAngle, setWindAngle] = useState(0);
	const [compassAngle, setCompassAngle] = useState(0);
	const [isScanning, setIsScanning] = useState(false);
	const [connected, setConnected] = useState(false);

	const toggleScan = () => {
		if (currentPeriph) {
			if (currentPeriph.connected) return;
		}
		if (!isScanning) {
			try {
				console.debug('[startScan] starting scan...');
				setIsScanning(true);
				setStatus('Scanning...');
				BleManager.scan(SERVICE_UUIDS, SECONDS_TO_SCAN_FOR, ALLOW_DUPLICATES, {
					matchMode: BleScanMatchMode.Aggressive,
					scanMode: BleScanMode.LowLatency,
					callbackType: BleScanCallbackType.FirstMatch,
					exactAdvertisingName: 'ESP32',
				})
					.then(() => {
						console.debug('[startScan] scan promise returned successfully.');
					})
					.catch(err => {
						console.error('[startScan] ble scan returned in error', err);
						setStatus('Scanning failed!');
					});
			} catch (error) {
				console.error('[startScan] ble scan error thrown', error);
				setStatus('Scanning failed!');
			}
		} else {
			BleManager.stopScan();
			setStatus('Scan stopped!');
		}
	};

	const handleStopScan = () => {
		setIsScanning(false);
		console.debug('[handleStopScan] scan is stopped.');
	};

	const handelConnectPeripheral = (
		event: BleDisconnectPeripheralEvent,
	) => {
		console.debug(
			`[handelConnectPeripheral][${currentPeriph.id}]`,
			event.peripheral,
		);
		currentPeriph.connected = true;
		console.debug(
			`[handelConnectPeripheral][${event.peripheral}] connected.`,
		);

		setConnected(currentPeriph.connected);
		setStatus(`Device connected!`);
	};

	const handleDisconnectedPeripheral = (
		event: BleDisconnectPeripheralEvent,
	) => {
		console.debug(
			`[handleDisconnectedPeripheral][${currentPeriph.id}] previously connected peripheral is disconnected.`,
			event.peripheral,
		);
		currentPeriph.connected = false;
		console.debug(
			`[handleDisconnectedPeripheral][${event.peripheral}] disconnected.`,
		);

		setConnected(currentPeriph.connected);
		setStatus(`Device disconnected!`);
		bleManagerEmitter.removeAllListeners("BleManagerDidUpdateValueForCharacteristic");
	};

	const handleUpdateValueForCharacteristic = (
		data: BleManagerDidUpdateValueForCharacteristicEvent,
	) => {
		console.debug(
			`[handleUpdateValueForCharacteristic] received data from '${data.peripheral}' with characteristic='${data.characteristic}' and value='${data.value}'`,
		);
	};

	const handleDiscoverPeripheral = (peripheral: Peripheral) => {
		console.debug('[handleDiscoverPeripheral] new BLE peripheral=', peripheral);
		if (!peripheral.name) {
			peripheral.name = 'NO NAME';
		}
		if (peripheral.name === WWV_DEVICE_NAME) {
			currentPeriph = peripheral;
			currentPeriph.connected = false;
			setConnected(currentPeriph.connected);
			currentPeriph.connecting = false;

			setStatus(`Device found!`);
			BleManager.stopScan().then(() => {
				console.log("BLE: Found", currentPeriph.name,' ', currentPeriph.id);
			})
		}
	};

	const togglePeripheralConnection = async (peripheral: Peripheral) => {
		console.log(`toggle connection: ${peripheral}`)
		if (peripheral && peripheral.connected) {
			try {
				await BleManager.disconnect(peripheral.id);
			} catch (error) {
				console.error(
					`[togglePeripheralConnection][${peripheral.id}] error when trying to disconnect device.`,
					error,
				);
			}
			peripheral.connected = false;
			bleManagerEmitter.removeAllListeners("BleManagerDidUpdateValueForCharacteristic");
		} else {
			await connectPeripheral(peripheral);
		}
	};

	async function toggleConnection() {
		togglePeripheralConnection(currentPeriph);
		setConnected(currentPeriph.connected == false);
	}

	async function connectAndPrepare(peripheral: string, service: string, characteristics: string[]) {
		// Connect to device
		await BleManager.connect(peripheral);
		// Before startNotification you need to call retrieveServices
		await BleManager.retrieveServices(peripheral);
		// To enable BleManagerDidUpdateValueForCharacteristic listener
		characteristics.forEach( async (characteristic) => {
			await BleManager.startNotification(peripheral, service, characteristic);
		});
		// Add event listener
		bleManagerEmitter.addListener(
			"BleManagerDidUpdateValueForCharacteristic",
			({ value, peripheral, characteristic, service }) => {
				if (characteristic === WWV_WINDANGLE_CHAR[0]) {
					let v = value[0]+value[1]*0x100;
					setWindAngle(v);
					console.log(`Received ${v} for characteristic ${characteristic}`);
				}
				if (characteristic === WWV_WINDANGLE_CHAR[1]) {
					let v = value[0]+value[1]*0x100;
					setAngle(v);
					console.log(`Received ${v} for characteristic ${characteristic}`);
				}
			}
		);
		// Actions triggereng BleManagerDidUpdateValueForCharacteristic event
	}
	const connectPeripheral = async (peripheral: Peripheral) => {
		try {
			if (!peripheral.connected) {
				peripheral.connecting = true;
				console.debug(`[currentPeripheral][${peripheral}]`);
				await connectAndPrepare(
					peripheral.id,
					WWV_WINDANGLE_UUID,
					WWV_WINDANGLE_CHAR
				)
				console.debug(`[connectPeripheral][${peripheral.id}] connected.`);
				
				peripheral.connecting = false;
				peripheral.connected = true;
				// before retrieving services, it is often a good idea to let bonding & connection finish properly
				await sleep(900);

				/* Test read current RSSI value, retrieve services first */
				const peripheralData = await BleManager.retrieveServices(peripheral.id);
				console.debug(
					`[connectPeripheral][${peripheral.id}] retrieved peripheral services`,
					peripheralData,
				);

				const rssi = await BleManager.readRSSI(peripheral.id);
				console.debug(
					`[connectPeripheral][${peripheral.id}] retrieved current RSSI value: ${rssi}.`,
				);

				if (peripheralData.characteristics) {
					for (let characteristic of peripheralData.characteristics) {
						if (characteristic.descriptors) {
							for (let descriptor of characteristic.descriptors) {
								try {
									let data = await BleManager.readDescriptor(
										peripheral.id,
										characteristic.service,
										characteristic.characteristic,
										descriptor.uuid,
									);
									console.debug(
										`[connectPeripheral][${peripheral.id}] descriptor read as:`,
										data,
									);
								} catch (error) {
									console.error(
										`[connectPeripheral][${peripheral.id}] failed to retrieve descriptor ${descriptor} for characteristic ${characteristic}:`,
										error,
									);
								}
							}
						}
					}
				}

				if (peripheral.id) {
					peripheral.rssi = rssi;
				}

			}
		} catch (error) {
			console.error(
				`[connectPeripheral][${peripheral.id}] connectPeripheral error`,
				error,
			);
		}
	};

	function sleep(ms: number) {
		return new Promise<void>(resolve => setTimeout(resolve, ms));
	}

	useEffect(() => {
		// turn on bluetooth if it is not on
		BleManager.enableBluetooth().then(() => {
			console.log('Bluetooth is turned on!');
		});

		if (Platform.OS === 'android' && Platform.Version >= 23) {
			PermissionsAndroid.check(
				PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
			).then(result => {
				if (result) {
					console.log('Permission is OK');
				} else {
					PermissionsAndroid.request(
						PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
					).then(result => {
						if (result) {
							console.log('User accept');
						} else {
							console.log('User refuse');
						}
					});
				}
			});
		}
		try {
			BleManager.start({ showAlert: false })
				.then(() => console.debug('BleManager started.'))
				.catch(error =>
					console.error('BeManager could not be started.', error),
				);
		} catch (error) {
			console.error('unexpected error starting BleManager.', error);
			return;
		}

		const listeners = [
			bleManagerEmitter.addListener(
				'BleManagerDiscoverPeripheral',
				handleDiscoverPeripheral,
			),
			bleManagerEmitter.addListener(
				'BleManagerStopScan', 
				handleStopScan),

			bleManagerEmitter.addListener(
				'BleManagerDisconnectPeripheral',
				handleDisconnectedPeripheral,
			),
			bleManagerEmitter.addListener(
				'BleManagerConnectPeripheral',
				handelConnectPeripheral,
			),

			bleManagerEmitter.addListener(
				'BleManagerDidUpdateValueForCharacteristic',
				handleUpdateValueForCharacteristic,
			),
		];

		handleAndroidPermissions();

		return () => {
			console.debug('[app] main component unmounting. Removing listeners...');
			for (const listener of listeners) {
				listener.remove();
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleAndroidPermissions = () => {
		if (Platform.OS === 'android' && Platform.Version >= 31) {
			PermissionsAndroid.requestMultiple([
				PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
				PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
			]).then(result => {
				if (result) {
					console.debug(
						'[handleAndroidPermissions] User accepts runtime permissions android 12+',
					);
				} else {
					console.error(
						'[handleAndroidPermissions] User refuses runtime permissions android 12+',
					);
				}
			});
		} else if (Platform.OS === 'android' && Platform.Version >= 23) {
			PermissionsAndroid.check(
				PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
			).then(checkResult => {
				if (checkResult) {
					console.debug(
						'[handleAndroidPermissions] runtime permission Android <12 already OK',
					);
				} else {
					PermissionsAndroid.request(
						PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
					).then(requestResult => {
						if (requestResult) {
							console.debug(
								'[handleAndroidPermissions] User accepts runtime permission android <12',
							);
						} else {
							console.error(
								'[handleAndroidPermissions] User refuses runtime permission android <12',
							);
						}
					});
				}
			});
		}
	};

	const renderItem = ({ item }: { item: Peripheral }) => {
		const backgroundColor = item.connected ? '#069400' : Colors.white;
		return (
			<TouchableHighlight
				underlayColor="#0082FC"
				onPress={() => togglePeripheralConnection(item)}>
				<View style={[styles.row, { backgroundColor }]}>
					<Text style={styles.peripheralName}>
						{/* completeLocalName (item.name) & shortAdvertisingName (advertising.localName) may not always be the same */}
						{item.name} - {item?.advertising?.localName}
						{item.connecting && ' - Connecting...'}
					</Text>
					<Text style={styles.rssi}>RSSI: {item.rssi}</Text>
					<Text style={styles.peripheralId}>{item.id}</Text>
					<Text style={styles.peripheralId}>Raw Data: {angle}</Text>
				</View>
			</TouchableHighlight>
		);
	};

	return (
		<>
			<StatusBar />
			<SafeAreaView style={styles.body}>
				<Pressable style={
						isScanning ? 
						styles.scanningButton : 
						styles.scanButton
					} onPress={toggleScan}>
					<Text style={styles.scanButtonText}>
						{isScanning ? 'Stop' : 'Scan'}
					</Text>
				</Pressable>
{/* 
				<Pressable style={styles.scanButton} onPress={retrieveConnected}>
					<Text style={styles.scanButtonText}>
						{isConnected ? 'Connected' : 'Connect'}
					</Text>
				</Pressable> */}

				<View style={[styles.row]}>
					<Text style={{
							fontSize: 15,
							textAlign: 'center',
							padding: 10,
							color: 'red'
						}}>
						{status}
					</Text>
				</View>

				<Pressable style={styles.scanButton} 
					onPress={ () => {
						toggleConnection();

					}}>
					<Text style={styles.scanButtonText}>
						{connected ? 'Disconnect' : 'Connect'}
					</Text>
				</Pressable>

				<View style={[styles.row]}>
					<Text style={{
							fontSize: 100,
							textAlign: 'center',
							padding: 10,
							color: 'white'
						}}>
						{angle}
					</Text>
				</View>

			</SafeAreaView>
		</>
	);
};

const boxShadow = {
	shadowColor: '#000',
	shadowOffset: {
		width: 0,
		height: 2,
	},
	shadowOpacity: 0.25,
	shadowRadius: 3.84,
	elevation: 5,
};

const styles = StyleSheet.create({
	engine: {
		position: 'absolute',
		right: 10,
		bottom: 0,
		color: Colors.black,
	},
	scanButton: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 16,
		backgroundColor: '#0a398a',
		margin: 10,
		borderRadius: 12,
		...boxShadow,
	},
	scanningButton: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 16,
		backgroundColor: Colors.red,
		margin: 10,
		borderRadius: 12,
		...boxShadow,
	},
	scanButtonText: {
		fontSize: 20,
		letterSpacing: 0.25,
		color: Colors.white,
	},
	body: {
		backgroundColor: 'black',
		flex: 1,
	},
	sectionContainer: {
		marginTop: 32,
		paddingHorizontal: 24,
	},
	sectionTitle: {
		fontSize: 24,
		fontWeight: '600',
		color: Colors.black,
	},
	sectionDescription: {
		marginTop: 8,
		fontSize: 18,
		fontWeight: '400',
		color: Colors.dark,
	},
	highlight: {
		fontWeight: '700',
	},
	footer: {
		color: Colors.dark,
		fontSize: 12,
		fontWeight: '600',
		padding: 4,
		paddingRight: 12,
		textAlign: 'right',
	},
	peripheralName: {
		fontSize: 16,
		textAlign: 'center',
		padding: 10,
	},
	rssi: {
		fontSize: 12,
		textAlign: 'center',
		padding: 2,
	},
	peripheralId: {
		fontSize: 12,
		textAlign: 'center',
		padding: 2,
		paddingBottom: 20,
	},
	row: {
		marginLeft: 10,
		marginRight: 10,
		borderRadius: 20,
		...boxShadow,
	},
	noPeripherals: {
		margin: 10,
		textAlign: 'center',
		color: Colors.white,
	},
});

export default App;
