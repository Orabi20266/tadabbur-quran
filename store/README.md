# متجر التطبيقات

- `privacy-policy.html` — انشره على رابط HTTPS ثابت واستخدمه في كلا المتجرين.
- `terms.html` — شروط الاستخدام، اختيارية في Google Play ومطلوبة غالباً في App Store.
- `app-store.md` — الاسم والوصف والكلمات المفتاحية وإجابات المراجعة لـ App Store Connect.
- `google-play.md` — الوصف وتصنيف المحتوى وإقرار أمان البيانات لـ Play Console.

## الأيقونات والشاشة الافتتاحية

الملفات المصدر في `assets/logo.svg` و`assets/logo-dark.svg`. أعد التوليد بعد أي تعديل:

```bash
npm run cap:icons -- --iconBackgroundColor '#1e6b4a' \
  --iconBackgroundColorDark '#123f2d' \
  --splashBackgroundColor '#f7f4ec' \
  --splashBackgroundColorDark '#10261c' \
  --ios --android
```

> لا تستخدم `--pwa` هنا؛ نسخة الويب المنشورة تبقى كما هي.
