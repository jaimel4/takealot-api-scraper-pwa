use base64::{engine::general_purpose::STANDARD, Engine};

#[tauri::command]
async fn fetch_image(url: String, proxy_url: Option<String>) -> Result<String, String> {
    println!("[fetch_image] Called with URL: {}", url);

    let mut client_builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .pool_max_idle_per_host(5)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(30));

    if let Some(proxy_str) = proxy_url {
        if !proxy_str.is_empty() {
            println!("[fetch_image] Using proxy: {}", proxy_str);
            let proxy = reqwest::Proxy::all(&proxy_str)
                .map_err(|e| {
                    let err_msg = format!("Failed to create proxy: {}", e);
                    println!("[fetch_image] ERROR: {}", err_msg);
                    err_msg
                })?;
            client_builder = client_builder.proxy(proxy);
        } else {
            println!("[fetch_image] No proxy configured");
        }
    } else {
        println!("[fetch_image] No proxy configured");
    }

    let client = client_builder.build().map_err(|e| {
        let err_msg = format!("Failed to build client: {}", e);
        println!("[fetch_image] ERROR: {}", err_msg);
        err_msg
    })?;

    println!("[fetch_image] Sending request...");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            let err_msg = format!("Request failed: {}", e);
            println!("[fetch_image] ERROR: {}", err_msg);
            err_msg
        })?;

    println!("[fetch_image] Response status: {}", response.status());

    if !response.status().is_success() {
        let err_msg = format!("Failed to fetch image: {}", response.status());
        println!("[fetch_image] ERROR: {}", err_msg);
        return Err(err_msg);
    }

    let bytes = response.bytes().await.map_err(|e| {
        let err_msg = format!("Failed to read bytes: {}", e);
        println!("[fetch_image] ERROR: {}", err_msg);
        err_msg
    })?;

    println!("[fetch_image] Received {} bytes", bytes.len());
    let base64_data = STANDARD.encode(&bytes);
    println!("[fetch_image] SUCCESS: Encoded to base64 ({} chars)", base64_data.len());

    Ok(format!("data:image/jpeg;base64,{}", base64_data))
}

#[tauri::command]
async fn fetch_image_buffer(url: String, proxy_url: Option<String>) -> Result<Vec<u8>, String> {
    println!("fetch_image_buffer called with url: {}", url);

    let mut client_builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .danger_accept_invalid_certs(true)
        .pool_max_idle_per_host(5)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(30));

    if let Some(proxy_str) = proxy_url {
        if !proxy_str.is_empty() {
            println!("Using proxy: {}", proxy_str);
            let proxy = reqwest::Proxy::all(&proxy_str)
                .map_err(|e| format!("Failed to create proxy: {}", e))?;
            client_builder = client_builder.proxy(proxy);
        }
    }

    let client = client_builder.build().map_err(|e| {
        println!("Failed to build client: {}", e);
        e.to_string()
    })?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            println!("Failed to send request: {}", e);
            e.to_string()
        })?;

    println!("Response status: {}", response.status());

    if !response.status().is_success() {
        return Err(format!("Failed to fetch image: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| {
        println!("Failed to get bytes: {}", e);
        e.to_string()
    })?;

    println!("Got {} bytes", bytes.len());
    Ok(bytes.to_vec())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![fetch_image, fetch_image_buffer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
