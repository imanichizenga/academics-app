from django.urls import path

from . import views as v

urlpatterns = [
    path("checkout/", v.CheckoutView.as_view()),
    path("orders/mine/", v.MyOrdersView.as_view()),
    path("orders/<uuid:pk>/status/", v.OrderStatusView.as_view()),
    path("orders/<uuid:pk>/resend/", v.ResendPushView.as_view()),
    path("orders/<uuid:pk>/cancel/", v.CancelOrderView.as_view()),
    path("orders/<uuid:pk>/claim/", v.ClaimOrderView.as_view()),
    path("orders/<uuid:pk>/receipt/", v.ReceiptView.as_view()),
    path("access/mine/", v.MyAccessView.as_view()),
]
