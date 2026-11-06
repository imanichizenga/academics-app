from django.urls import path

from . import views as v

urlpatterns = [
    path("login/", v.LoginView.as_view()),
    path("register/", v.RegisterView.as_view()),
    path("refresh/", v.RefreshView.as_view()),
    path("logout/", v.LogoutView.as_view()),
    path("logout-all/", v.LogoutAllView.as_view()),
    path("me/", v.MeView.as_view()),
    path("change-password/", v.ChangePasswordView.as_view()),
    path("otp/request/", v.OtpRequestView.as_view()),
    path("otp/confirm/", v.OtpConfirmView.as_view()),
    path("impersonate/stop/", v.StopImpersonateView.as_view()),
]
