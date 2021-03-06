<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@firebase/auth-types](./auth-types.md) &gt; [Auth](./auth-types.auth.md) &gt; [useEmulator](./auth-types.auth.useemulator.md)

## Auth.useEmulator() method

Modify this Auth instance to communicate with the Firebase Auth emulator.

<b>Signature:</b>

```typescript
useEmulator(url: string, options?: { disableWarnings: boolean }): void;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  url | string | The URL at which the emulator is running (eg, 'http://localhost:9099'). |
|  options | { disableWarnings: boolean } |  |

<b>Returns:</b>

void

## Remarks

This must be called synchronously immediately following the first call to [initializeAuth()](./auth.initializeauth.md)<!-- -->. Do not use with production credentials as emulator traffic is not encrypted.

