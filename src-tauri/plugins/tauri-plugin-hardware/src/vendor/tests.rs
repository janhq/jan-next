use crate::vendor::{nvidia, vulkan};

#[test]
fn test_get_nvidia_gpus() {
    let gpus = nvidia::get_nvidia_gpus();
    for (i, gpu) in gpus.iter().enumerate() {
        println!("GPU {}:", i);
        println!("    {:?}", gpu);
        println!("    {:?}", gpu.get_usage());
    }
}

#[test]
fn test_get_vulkan_gpus() {
    let gpus = vulkan::get_vulkan_gpus();
    for (i, gpu) in gpus.iter().enumerate() {
        println!("GPU {}:", i);
        println!("    {:?}", gpu);
        println!("    {:?}", gpu.get_usage());
    }
}

#[test]
fn test_get_vulkan_gpus_on_desktop() {
    let gpus = vulkan::get_vulkan_gpus();

    // Test that function returns without panicking on desktop platforms
    let _ = gpus.len();

    // If GPUs are found, verify they have valid properties
    for (i, gpu) in gpus.iter().enumerate() {
        println!("Desktop GPU {}:", i);
        println!("    Name: {}", gpu.name);
        println!("    Vendor: {:?}", gpu.vendor);
        println!("    Total Memory: {} MB", gpu.total_memory);
        println!("    UUID: {}", gpu.uuid);
        println!("    Driver Version: {}", gpu.driver_version);

        // Verify that GPU properties are not empty/default values
        assert!(!gpu.name.is_empty(), "GPU name should not be empty");
        assert!(!gpu.uuid.is_empty(), "GPU UUID should not be empty");

        // Test vulkan-specific info is present
        if let Some(vulkan_info) = &gpu.vulkan_info {
            println!("    Vulkan API Version: {}", vulkan_info.api_version);
            println!("    Device Type: {}", vulkan_info.device_type);
            assert!(!vulkan_info.api_version.is_empty(), "Vulkan API version should not be empty");
            assert!(!vulkan_info.device_type.is_empty(), "Device type should not be empty");
        }
    }
}

mod nvidia_driver {
    use crate::vendor::nvidia::CudaVersion;

    // NVML reports the CUDA a driver supports as 1000 * major + 10 * minor.
    #[test]
    fn the_driver_reported_cuda_int_splits_into_major_and_minor() {
        assert_eq!(
            CudaVersion::from_driver_int(13020),
            Some(CudaVersion { major: 13, minor: 2 })
        );
        assert_eq!(
            CudaVersion::from_driver_int(12080),
            Some(CudaVersion { major: 12, minor: 8 })
        );
        assert_eq!(CudaVersion::from_driver_int(0), None);
        assert_eq!(CudaVersion::from_driver_int(-1), None);
    }

    #[test]
    fn a_cuda_version_parses_and_prints_as_major_dot_minor() {
        let v = CudaVersion::parse(" 13.2 ").expect("parses");
        assert_eq!(v.to_string(), "13.2");
        assert_eq!(CudaVersion::parse("13"), None);
        assert_eq!(CudaVersion::parse("x.y"), None);
    }

    // Minor 10 is newer than minor 2; a string compare would get it backwards.
    #[test]
    fn versions_order_numerically() {
        let older = CudaVersion { major: 12, minor: 9 };
        let newer = CudaVersion { major: 13, minor: 0 };
        assert!(older < newer);
        assert!(CudaVersion { major: 13, minor: 2 } < CudaVersion { major: 13, minor: 10 });
    }
}
