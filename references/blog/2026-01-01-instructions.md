---
title: 'Installing VoltageOS on OnePlus 12R / Ace 3'
description: 'Firmware prerequisites, installation steps, and recovery notes for aston and astonc.'
pubDate: 'Jan 2026'
slug: 'instructions'
heroImage: '../../assets/vos-instructions.jpeg'
tags: ['Android', 'voltageOS' , 'guides']
---
---
# Prerequisites:
- Device must be running OxygenOS(12R)/ColorOS(ACE3) version 16.0.1.300,
- Flash the current build again using local install to ensure both slots have the same firmware. (Failing to do so will get you bricked)

# Clean flash:
- Reboot to bootloader
- Flash boot, init_boot, vendor_boot, dtbo and recovery images
   -  `fastboot flash boot boot.img`
   -  `fastboot flash init_boot init_boot.img`
   -  `fastboot flash vendor_boot vendor_boot.img`
   -  `fastboot flash dtbo dtbo.img`
   -  `fastboot flash recovery recovery.img`
- Reboot to recovery
- Sideload ROM zip
   -  `adb sideload voltage-*.zip`
   -  `adb sideload BiTGApps-arm64*.zip` (Optional)
   -  `adb sideload microG-Installer-*.zip` (Optional)
- Format data after sideload
- Reboot and voila!

# Updating to a newer build (dirty flash):
- Sideload ROM zip
- Sideload Gapps zip
- Reboot and voila!

# If sideloading rom gives error 7:
- Reboot to recovery
- Enter fastbootd
- fastboot wipe-super super_empty.img
- Enter recovery
- Sideload the rom zip
- Format data
- Reboot

# If after sideloading rom, device boots to bootloader:
- Do clean flash steps again
- When it asks for Yes/No prompt for installing additional packages, select Yes
- After device reboots recovery, sideload again.
- This time when it asks for Yes/No prompt for installing additional packages, select No
- Format and Reboot