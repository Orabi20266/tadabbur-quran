# إصدار التطبيق الأصلي (iOS / Android)

هذه النسخة معزولة عن نسخة الويب المنشورة. الفرع `mobile/capacitor` يغلّف نفس واجهة الويب
داخل Capacitor 8 دون تغيير سلوك النسخة الحالية على `main`.

## البناء محلياً

المتطلبات: Node 22+، Xcode 26+ (لـ iOS)، Android Studio 2025.2.1+ (لـ Android).

```bash
npm ci
npm test
npm run build
npx cap sync android   # أو: npx cap sync ios
```

ثم افتح `android/` في Android Studio أو `ios/App/App.xcworkspace` في Xcode.

> ملاحظة: iOS يستخدم CocoaPods لأن إضافة التعرّف على الكلام لا تحتوي على `Package.swift`.
> ملفات `Podfile` و`Podfile.lock` مودجة في المستودع.

## ما يفعله CI

- على كل push/PR إلى `mobile/capacitor`: اختبارات + بناء ويب + APK للتصحيح + تحقق من بناء iOS للمحاكي.
- على وسم `v*` (مثال `v1.0.1`) مع أسرار التوقيع: AAB موقّع لـ Google Play وIPA موقّع لـ App Store كأدوات (artifacts).
- إذا لم تكن أسرار التوقيع مهيأة، يبقى الوسم ناجحاً لكنه يُنتج APK معاينة غير موقّع ولا يُنتج IPA؛ يُستخدم للاختبار الشخصي عبر GitHub Releases فقط.

## الأسرار المطلوبة في GitHub Actions

### Android

| السر | الوصف |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | ملف keystore بصيغة base64 سطر واحد |
| `ANDROID_STORE_PASSWORD` | كلمة مرور المتجر |
| `ANDROID_KEY_ALIAS` | اسم مفتاح التوقيع |
| `ANDROID_KEY_PASSWORD` | كلمة مرور المفتاح |
| `ANDROID_KEYSTORE_TYPE` | اختياري: `JKS` (الافتراضي) أو `PKCS12` |

لإنشاء keystore مرة واحدة:

```bash
keytool -genkeypair -v -keystore tadabbur.jks -alias tadabbur \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -i tadabbur.jks | tr -d '\n'
```

### iOS

| السر | الوصف |
| --- | --- |
| `IOS_CERTIFICATE_BASE64` | شهادة Apple Distribution بصيغة `.p12` محوّلة إلى base64 |
| `IOS_CERTIFICATE_PASSWORD` | كلمة مرور الـ p12 (قد تكون فارغة) |
| `IOS_PROVISION_PROFILE_BASE64` | ملف App Store provisioning profile محوّل إلى base64 |
| `IOS_CODE_SIGN_IDENTITY` | اختياري: `Apple Distribution` هو الافتراضي |

يستخرج سير العمل اسم الـ profile ورقم الفريق والتخزين داخل الـ runner تلقائياً، لذا لا حاجة لأسرار إضافية للمعرّفات.

## رفع المتاجر

1. نزّل الـ artifact من تشغيل الوسم.
2. Google Play Console → Internal testing → إنشاء إصدار جديد وارفع `.aab`.
3. App Store Connect → TestFlight → ارفع `.ipa` عبر Transporter ثم أضف الاختبارين.
4. اربط سياسة الخصوصية وشروط الاستخدام من مجلد `store/` بعد نشرهما على رابط عام ثابت.

## قبل النشر النهائي

- جرّب التعرّف الصوتي على جهاز حقيقي بـ `ar-SA` مع إذن الميكروفون.
- جرّب الإملاء اليدوي كبديل كامل عند رفض الإذن.
- أكّد سلوك الحروف المقطّعة مع صوت حقيقي؛ هذه المسألة **لم تُحل بعد** ولا يجوز الإعلان عنها كميزة مكتملة.
- حدّث `APP_VERSION` في `src/lib/version.ts` و`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` في `ios/App/App.xcodeproj/project.pbxproj` و`versionName`/`versionCode` في `android/app/build.gradle` معاً، وإلا لن يطابق تنبيه التحديث رقم الإصدار المثبّت.
- ارفع لقطات شاشة بالأبعاد المطلوبة؛ القائمة في `store/README.md`.
